# Hearth — Feature Wishlist

**Status: sixteen sprints are shipped and nothing is open — this file opens
the first two arcs of phased work, and Phase 1 — *Songs you can hear*, on
Claude Opus 5 — is the next thing to build.** Sprint 16 closed green across
all eleven harness modes (soak / nan / determinism / save / depth / eleven
through sixteen): 5 islands × 40 days, ~22,465 full-cast audits, 0 violations
and 0 breadcrumbs; identical `pack()` hashes on seeds 7 and 20260819 across
two fresh runs each; the autosave round-trip through a real reload passing,
and a forged v11 save loading clean with every v12 field empty. **There is no
prompt file for Hearth** — it was never one of the twenty-two projects in the
parallel split the prompt rounds ran, it carried no "Questions for Devon"
block, and
no site handoff ever mentioned it. The record of sprints 4–16 — what shipped,
and what fought back in each — is in `HISTORY.md`; this file is the plan.

## What it is

A living island at `Projects/hearth/index.html`. No build step, no
dependencies, no fonts, no images, no network — nine classic scripts, one
stylesheet and 61 lines of markup, 272,660 bytes all in (~266 KB), and it runs
from `file://` as happily as from GitHub Pages. Unlike most of the board it
does *not* need to be served, because it deliberately is not ES modules: the
sprint-12 split kept classic `<script src>` tags precisely so opening the file
off a disk still works.

It generates an island from a seed and then leaves it alone. Terrain, trees, a
stream, a hill, a horizon silhouette. Settlers with names, ages that advance,
two traits from a list of ten, a favorite spot, relationships, and a job state
machine that chops, tills, harvests, fishes, builds and carries. Four seasons
of five days each (`YEAR=20`), weather fronts with fog and lightning and snow
that lies and melts, tides twice a day, a granary that has to hold or people
go hungry and leave. Partnerships form, children are born and grow up, elders
die and get a stone on the hill. The village names itself on day 10 and starts
using the name. Everything is synthesized — thirteen one-shots and a seasonal
pad through a Web Audio graph built in `startAudio()`, no files — and the
whole world LZ-compresses into the URL hash, so an island is a link.

What sprints 12–16 built on top of that is the part worth protecting: the
island keeps its own memory. Things (`things[]`) are made or found and pass
from hand to hand when a holder dies. Stories at the fire get a `tl` count and
**grow** at three tellings — the text is permanently rewritten and the old
version is not kept. A grown story with ground under it puts a *name* on that
ground the next morning, walked out to by a child at first light; the walks
pile stones (`loreN`) that draw as worn grass, then a cairn. Once a year in
spring an elder walks the children round every named place, oldest story
first, and finishes on the hill saying the dead's names. At six tellings a
grown story gets a **song**, which lives only in the named people who carry it
(`songs[].kn`) and is **lost** when the last knower dies or sails. And each
finished year takes the name the chronicle earns it — "the year of the fever",
"the year of the cradles" — re-derived from `chron`, never saved.

What it is not: a game you play. No goal, no fail state, no economy, and the
watcher's interactions (a sapling, a spring, a skipped stone, a gust, rain
from a cloud, a dream, a story at the fire) are blessings rather than
commands. It is also not a thing anyone has watched for a *decade*: heirlooms,
the walking of the bounds, elders telling children of the dead and song loss
all pay out on islands older than the 120 days `depth` mode runs, and the
harness forces them because nothing else can reach them.

## The architecture that is there

`index.html` (61 lines) is head, markup and an ordered list of nine
`<script src>` tags. `hearth.html` (11 lines) is a redirect stub that carries
`location.hash` across the hop, because old share links hold a whole island in
that hash. `css/hearth.css` (66 lines) is the HUD, the log, the person card
and the chronicle panel — everything else is drawn.

The nine scripts, in the order they load, which is the order the original
single file's sections sat in and is load-bearing:

- **`js/core.js`** (341) — the seeded rng (`mulberry`, `R`, `rnd`, `pick`,
  `hash`, `noise2`), every world constant (`W=110,H=70,T=8,YEAR=20`), every
  piece of top-level mutable state, `newWorld()`, terrain painting, the
  `say()` log, the people primitives, and the tables everything else reads:
  `GROW` (24 story kinds that can grow), `LORE_PLACE` (8 kinds with ground
  under them), `BLD`, `TRAITS`, `MADEV`/`MADE`, `yearName()`.
- **`js/flavor.js`** (265) — the log grammar. `G` is **216** condition/template
  pairs; `flavor()` builds a ~90-key context per call, filters, weights,
  picks, and refuses a template already used today.
- **`js/life.js`** (342) — `newDay()` (the once-a-day roll for arcs, births,
  partnerships, deaths, the bounds, elders telling children of the dead),
  `die`/`leave`/`remove`, `loseSongs`, `chatNews`, the building ladder, boats,
  `WORKS`, and the wildlife.
- **`js/watcher.js`** (272) — clouds, the blessings, dreams, `tellStory()`
  (the fire night, where stories grow and songs are composed), `boundsOut()`
  (the rite), the year's fortunes (`arc`), the four `WAYS`, the faith/prayer
  account, and the weather machine.
- **`js/sim.js`** (278) — one function, `step(dt)`: weather, snow, drought,
  crops, arrivals, and the per-person task switch (chop, till, harvest, fish,
  build, carry, gather, play, tag, snowman, bounds, pilgrim, mourn, …).
- **`js/render.js`** (297) — `drawFace()` (the 16×16 procedural portrait), the
  person card, and `draw()`: one 880×560 canvas, a terrain layer repainted
  only when `paintedKey` changes, a painter's-algorithm `ents[]` sorted by y.
- **`js/audio.js`** (126) — the graph, built once in `startAudio()`:
  `master → {ambG, sfxG, musG}` with wind, waves, rain (straight to master,
  because it is what everything ducks under), a spring, crickets, and a
  two-oscillator pad retuned by season. `note(f,dur,vol,type,pan,bus,when)` is
  the one-note primitive; `knock()` is the one-shot primitive.
- **`js/save.js`** (123) — the chronicle panel and `.txt` export, the LZ codec,
  and `pack()`/`unpack()`/`loadHash()`/`saveHash()`.
- **`js/main.js`** (152) — time controls, hints, input and the view, the boot
  sequence, the RAF loop, and `window.__hearth`, the object the harness drives
  the game through.

That is ~2,196 lines of JavaScript. The load-bearing habits: **there is no
module system and no `"use strict"`** — every top-level `let`/`const` shares
one global lexical scope across the nine files, so a duplicated name silently
shadows, and boot-time execution belongs only in `main.js`. **The rng is the
whole contract** — two islands opened from the same link must consume `R()`
identically, which is why sprint 16's inherited skin colour still consumes the
`rr()` draws it replaces and why the aurora is a pure function of `seed` and
`dayCount` rather than a roll. **Data-not-code holds in the tables** (`GROW`,
`LORE_PLACE`, `WORKS`, `WAYS`, `BLD`, `G`) and breaks down everywhere else:
`sim.js` is a 250-line `switch`, and `unpack()` is one 60-line function that
is also the migration ladder.

There is no pure module with its own unit suite anywhere. The only test is
`test/harness.mjs` (937 lines), which drives the real page in Playwright's
Chromium through `window.__hearth`, pausing the RAF loop first so every
`step()` comes from the test file. Eleven modes live in it as top-level
`if (mode === '…')` blocks: `soak`, `nan`, `depth`, `determinism`, `save`, and
one per sprint, `eleven` through `sixteen`. It is a good harness. It is not a
fast one, and it cannot tell you a function is wrong, only that an island is.

## Conventions a new builder must know

Read these before the first edit. Every one was learned by a sprint getting it
wrong, and the handoff that names it is cited.

- **The load order in `index.html` is the old single file's order and it
  matters.** Add a new script to the end, never reorder; no `"use strict"`
  (the code predates it); never declare the same top-level name in two files;
  keep all boot execution in `main.js`. Sprint 12 proved the split rather than
  assuming it — its 30-day `pack()` hash on seed 7 was byte-identical to the
  single file's.
- **`/* */` comments only, anywhere near a dense line.** Sprint 12 appended a
  `//` comment to the arrival-timer chain and commented out the `if` that
  followed on the same line. Much of this file is several statements per line.
- **Anything that draws from `R()` is simulation; anything that does not is
  presentation, and presentation may not touch the stream.** Sprint 16's whole
  sky pass (rainbow, aurora, shooting stars, mist, shimmer) is zero `R()`
  draws, and `auroraNight()` is `((seed^imul(dayCount,2654435761))>>>0)%100`
  precisely so every device opening the same link agrees about the sky. Any
  change that shifts the stream is re-verified against two fresh determinism
  runs on seeds 7 and 20260819.
- **A sim decision may never read presentation state.** `hintsDone` is
  per-device `localStorage`; sprint 16 gated the children's copied
  stone-skipping on a *saved* counter (`skipN`) instead, so a shared island
  behaves the same on every phone. `store()`/`pref()` (`hearth.*`) hold the
  sound and music toggles, the hints and the autosave — nothing the island
  itself knows.
- **There are two version gates and both must move when `pack()` bumps.**
  `loadHash()` (`js/save.js:118`) and the autosave boot path
  (`js/main.js:139`) each carry their own `o.v>=5&&o.v<=12`. Sprint 12 shipped
  with one stale; grep `o.v>=5`, expect two hits.
- **Save changes are additive, and old saves read as empty, never as an
  error.** A packed person is a positional array of 29 slots (`packP`,
  indices 0–28) — append only, never reorder; new keys land as `o.foo||0`.
  Sprint 15's v10 forgery loads with every grave's `vn` at zero, and that is
  correct: the island tidied its cairns.
- **Version-pinned assertions in older harness modes are a recurring trap.**
  `thirteen` asserted `v === 9` and `fourteen` asserted `rt.v !== 10`; both
  broke on the next bump. Grep `rt.v !==` *and* `o.v !==` on every version
  move, and write new assertions as `>=`.
- **Do not test by scraping the log.** `say()` keeps only the last nine `<p>`
  children (`js/core.js:267`) and an ordinary sim-day evicts a forced line
  before any check runs. Assert on durable state — grave touch counts,
  `p.heard` fields, chronicle entries. Sprint 16 learned it one layer down: a
  whole conversation can start, arrive and exchange news inside one `step()`,
  so "did I ever glimpse `task==='chat'`" reads false while both pockets
  already hold the news.
- **In-progress tasks are deliberately not saved; a year stamp is what stops a
  rite re-running.** `walkP`, `boundsP` and each walker's route dissolve on
  reload; `boundsYr` is what gets packed. Relatedly, `LORE_PLACE[k].at()` must
  stay `rnd()`-free and read live world state: named places pack as kinds
  (`lp:['landing']`), not coordinates, and re-derive at load *after* farms and
  buildings restore, because `at()` reads them.
- **Counts are uncapped; visual tiers are capped.** Cairns top out at 7 walks
  and grave marks at 12 visits, but `loreN` and `gr.vn` keep counting — a
  child who counts the stones deserves a true answer.
- **Any new sound, or any gain touched, owes the listening pass:**
  `node harness.mjs twelve`, which plays every one-shot through an
  `AnalyserNode` on the real master bus. The standing numbers: thirteen
  one-shots in 0.07–0.19, the sfx bus at 0.723 in a storm against 0.954 clear,
  the storm bed at ~0.20. Every sprint since 12 has run it even when nothing
  was touched.
- **The test invocation, in full.** From `Projects/hearth/test`, once
  `npm install`; then `node harness.mjs soak` (5 islands × 40 days, the
  standing gate), `determinism`, `save`, `depth --days 120`, `nan` (400 days
  with starvation windows), and the per-sprint regressions by name, `eleven`
  through `sixteen`. `package.json` scripts only the first four. Chromium
  launches with `--autoplay-policy=no-user-gesture-required` always and falls
  back to `/opt/pw-browsers/chromium` when Playwright's own download is
  absent.
- **Every sprint ends with a handoff file in the project root** in the same
  five sections: a 5-line changelog, measured numbers, decisions made without
  asking, complications hit, and quality-bar leftovers for the next sprint.
  Phases here end the same way — that leftovers list is what made the last
  four sprints possible to start.

## Questions for Devon

- **Should Hearth join the board's regression suite?** It is on the homepage
  (`index.html:492`, tagged Sim, `data-new`) but has no entry in
  `Tools/board-check/games.mjs` — thirteen games are described there, Hearth
  is not one — and no `assets/previews/hearth.jpg`, so `npm run games` never
  opens it and the card has no preview. Its own harness is far better than a
  board-check `open()` recipe; the question is whether the board wants the
  shallow smoke test anyway.
- **Does Hearth get a CI workflow?** `.github/workflows/` carries
  `school-generator-ci.yml` and `numina-ci.yml` and nothing for Hearth, so
  sixteen sprints of regressions have only run on somebody's desk. The full
  suite is eleven modes of headless Chromium; a PR gate of `soak --days 12` +
  `determinism` + `save` is minutes. Which shape?
- **Does the name-recycling quirk stay a feature?** Songs live on names
  (`songs[].kn` is a list of strings) and the ancestor-naming rule can hand a
  newborn a dead knower's name, so that child "knows" every song the ancestor
  knew and can resurrect a lost one. Rare; reads as poetry; fixing it means
  packing knower identity beyond names. Keep, or pay for identity?
- **Does the population cap overshoot actually grate?** Six sprints have noted
  it and six have concluded it is not worth one: `popCap()` is
  `4+houses.length*2`, arrivals respect it, and the birth rule
  (`js/life.js:102`) allows `people.length<popCap()+1`, so rich islands settle
  at 47–49 by day 121. The number is one character. Is 49 wrong, or just
  noticed?

## The standing backlog

Everything below is open and *unclaimed by any phase in this file* — the
sixteen handoffs' other leftovers (the missing song tune, the elder roll, the
prayer priority, the most-visited stone, ring-around, the far island, the
migration ladder, the missing CI) are claimed by Phases 1–8. Pull from here,
and add to this list rather than starting a new one.

**The island's memory**
- The recited names on the hill are a `say()` line only, never chronicled: a
  walk touching four stones leaves no record of *whose* names.
- Only 8 of the 24 growable story kinds have ground under them
  (`LORE_PLACE`). `fever`, `hardwinter`, `heir` and the rest grow with nowhere
  to stand — some genuinely have no place, some do.
- `LORE_PLACE.way.at()` matches on `includes('the sail')` against a grown
  entry's label. Grep it before rewording any `WAYS` line.
- Made-thing names are per-seed (`MADE(ci)`, three variants per craft) but the
  variants are global constants, and small seeds all land on variant 0.
- Grown stories still never change what anyone *wants* — only where they walk.

**People and behaviour**
- The bounds walks in naming order, which is chronicle order, which is nearly
  but not quite oldest-first — an elder may cross the island twice. Reads as
  ceremony; sort by angle around the hearth if it grates.
- Cairn tiers (1/2/4/7/12), the bounds chance (60% per eligible spring day)
  and the repeat-walk rate (25% per fire night) are felt, not measured.
- Nobody carries anything but an heirloom, and nothing is ever put down.
- The trade boat arrives once a season, is waved at, and leaves. No trade.

**People and behaviour, from the sprint handoffs**

Nine leftovers the thirteen sprint handoffs named and no phase in this file
claims. Carried here when those handoffs were retired into `HISTORY.md`.

- **Sheltering islanders vanish entirely during a storm.** A lit window would
  fix the feeling (sprints 5 and 6).
- **The beached-boat pixel at the hut is crude** (sprints 5 and 6).
- **Deer do not avoid water when fleeing across a narrow neck** — they retarget
  six times, then go anyway (sprints 5 and 6).
- **A lone surviving child has no behaviour but `play`** (sprint 6).
- **The NaN islander is an open case.** Observed once on a random island that
  had collapsed to one person by day 44; never reproduced since, including
  under forced starvation for 144 sim-days. The guard converts it from a
  permanent ghost into a one-frame blip with a breadcrumb — if a
  `hearth: non-finite position` warning ever appears in a console, the task
  name in it is the lead (sprint 8).
- **A storm-heavy island's first 40 days can look broken.** Storms send
  everyone indoors, hunger drives people off, and with `food` low no arrivals
  come; one observed island had three people gone by day 8 and wood untouched
  at its starting 12, and recovered on its own by day 51. Worth a balance pass:
  maybe let people work through light rain, or give the granary a floor
  (sprint 5).
- **Works in progress lose progress on save**, the shrine included — it
  re-arms itself at the next dawn via `faithSt`, so the stone always eventually
  stands (sprint 11).
- **The shelf in the hall has no art.** Things on it exist only in prose; a
  two-pixel row inside the hall when `things.some(t=>!t.holder)` would be a
  nice touch (sprint 12).
- **Named places have no art on the ground.** They exist in spot labels, walks
  and the chronicle, but the ground draws nothing — a worn patch, or a small
  cairn after enough walks, would be the same trick as the shelf (sprint 13).

**Format, tooling, and the machine**
- There is no pure module and no unit suite; everything is tested by driving
  the real page, which means no test can say a function is wrong.
- No preview image and no `Tools/board-check/games.mjs` entry, so `npm run
  games` has never opened this project.
- `chron`, `events` and every person's `hist` grow without bound, and nobody
  has measured frame time past day 120.

## Arc one — a decade you can sit through

Sixteen sprints built an island that keeps its own memory: things pass,
stories grow, ground takes names, stones pile, songs are carried and lost, and
years get called what the chronicle earns them. Arc one builds for the *time*
that memory needs. Four of those systems — heirlooms, the bounds, elders
telling children of the dead, song loss — have never fired unforced in a run,
because 120 days is six years and every one of them wants a generation. The
arc makes a decade reachable, makes the one system with no output audible,
puts the save format on a footing that can survive the next eight versions,
and then makes the whole record something you can hand to somebody who was not
watching. **Ranked by impact, and the order is the recommendation.**

The model convention for this project: most phases run on **Claude Opus 5**.
**Claude Fable 5.1** is named only where a wrong answer would be silent — a
simulation or rules change that has to hold the determinism contract and the
soak invariants, a save-format design everything downstream inherits, or a
refactor of entangled code whose only safety net is a headless island. Surface
work, content tables, audio synthesis around the existing `note()` pattern,
harness wiring around an existing mode, and CSS: **Claude Opus 5.**

A phase is *finished* only when its branch has become a pull request, the pull
request has merged to main with CI green (Phase 8 is what makes that sentence
true for Hearth; until it lands, "green" means the full harness run pasted
into the closing report), and the closing report — a handoff file in the
project root, in the established five-section shape — names the **next open
phase's number and its named model**.

## Phase 1 — Songs you can hear

**The island composes music, names it, teaches it, mourns it when the last
person who knew it dies, and you never hear a note.**

Sprint 16 built songs completely except for the sound and said so on purpose:
"a real melody system is its own sprint with its own listening pass." This is
that sprint, and everything it needs exists — `note()` takes a bus and a
`when`, `KEYS` holds a root and a five-note scale per season, `wayTune()` is
the working precedent for a short phrase scheduled ahead on `sfxG`, and
`songs[].ci` is already a perfectly good melody seed. The discipline is the
point: inside the existing gain budget, not beside it.

- [ ] **`songTune(sg)` — a phrase from a song's own identity.** 6–10 scale
  degrees derived from `sg.ci` and `seed` (never `R()`, so a shared link hums
  the same tune), quantized to `KEYS[sea()]`, with the season's key the only
  thing that moves between hearings.
- [ ] **Fire nights only, and only the moments that already print prose.** The
  composition night, an older song started near the end of a telling, and a
  returner bringing a lost tune home. Nothing hums at work.
- [ ] **Voices, not one oscillator.** The composer carries the phrase and the
  people who know it come in on the second pass, which is what the prose says
  happens: one `note()` per voice per degree, scheduled with `when`, through
  `sfxG` under the existing storm ducking.
- [ ] **A lost song is silent, and that is the design.** When `loseSongs()`
  fires nothing plays; the `songlost` chronicle entry carries it. Same
  precedent as the answered prayer — the island's most important sounds are
  the ones it does not make.
- [ ] **Extend `harness.mjs twelve` rather than adding a mode.** The tune
  joins the same `AnalyserNode` table, on a peak budget that keeps the sfx bus
  where it is (0.723 storm / 0.954 clear), plus an assertion that two runs of
  a seed produce the same degree sequence.

*Leans on:* `js/audio.js` (`note`, `KEYS`, `wayTune`, `sfxG`),
`js/watcher.js`'s `tellStory`, `js/life.js`'s `loseSongs`. *Save:* none — the
tune is derived from `sg.ci` and the seed, the way `yearName()` is derived
from the chronicle. *Model:* **Claude Opus 5** — synthesis in an established
pattern with a measurement pass that already exists.

## Phase 2 — Decades, not years

**Four of the island's best systems have never happened on their own, because
nobody has ever watched one of these islands grow up.**

Heirlooms pass rarely by day 121. The walking of the bounds has never launched
unforced in a depth run. Elders telling children of the dead fired zero times
in both. No song has ever been lost outside a forced test. Sprints 12 through
16 each wrote a version of the same sentence — *this pays out on decade-old
islands, nothing to fix* — and none made a decade reachable. This phase does,
on both sides: a way to get there, and the confidence that arriving is
correct.

- [ ] **A generational speed.** Past the existing 1× / 3× / 10×, a mode that
  batches `step()` between paints and skips the presentation-only layers while
  keeping the log and the chronicle. `main.js` already loops `step(dt)` per
  frame by `speed`; this is the same idea past the point where drawing is the
  cost.
- [ ] **Profile a 500-day island first and write the number down.** Where the
  frame goes at pop 48 with 500 days of `chron`, `events`, per-person `hist`
  and `prints`. Nothing has been measured past 120 days, and the answer
  decides how much of the rest of this list is real.
- [ ] **Bound what grows without bound.** `chron` is packed and rendered in
  full; a person's `hist` is every line they ever earned. Per list: cap,
  summarize, or leave it and pay. The chronicle is the island's point and
  should be the last thing cut.
- [ ] **A `decade` harness mode.** 20 game-years on two fixed seeds asserting
  that the bounds walks unforced, a song is lost unforced, an heirloom passes,
  an elder tells a child about somebody under a stone, and the soak audits
  stay at zero violations throughout.
- [ ] **Determinism across the fast path.** The generational speed must
  produce a `pack()` hash identical to the same island run at 1× for the same
  days. If it cannot, it is a different simulation and must not ship.
- [ ] **Then re-tune what the decade exposes.** The `.05`/day elder roll, the
  60% bounds chance, the 25% repeat-walk rate and the cairn tiers are felt
  numbers; a decade run is the first thing that could measure them.

*Leans on:* `js/sim.js`'s `step`, `js/main.js`'s loop and `setSpeed`,
`js/save.js`'s `pack`, `test/harness.mjs`'s `depth` and `soak`. *Save:* none —
but the growth bounds may change what `pack()` writes, in which case it is an
additive version bump on Phase 3's ladder. *Model:* **Claude Fable 5.1** — a
second time path through the same simulation that must produce a bit-identical
world is exactly the kind of wrong answer that stays silent.

## Phase 3 — The migration ladder

**Eight save versions are handled by `||` defaults scattered through one
sixty-line function, and there is no way to test a single hop.**

`unpack()` accepts v5 through v12. The whole migration story is `o.ln||[]`,
`o.sg||[]`, `a[26]?1:0`, and exactly one explicit version test (`o.v>=8`, for
works in progress). It has held for eight versions because each sprint forged
a save by hand and ran it through the harness — a genuinely valuable practice
that produced the v6–v11 forgeries now scattered across six modes. But every
new field costs a fresh read of the whole function, the version gate has been
missed once already, and nobody can test "does a v7 island become a correct
v12 island" except by loading one and looking.

- [ ] **`migrate(o)` — one function, one hop at a time.** A table of
  `{from, to, fn}` steps applied in order until `o.v` is current; `unpack()`
  then reads only the current shape and stops carrying defaults for shapes it
  will never see again.
- [ ] **One version gate, shared.** Fold `js/save.js:118` and `js/main.js:139`
  into a `SAVE_MIN`/`SAVE_V` pair both paths read. The two-gate bug has cost
  one sprint already.
- [ ] **Move the forged saves into fixtures.** The v6–v11 forgeries live
  inline in `eleven` through `fifteen`; as data, all of them can run through
  every future ladder in one mode instead of five.
- [ ] **A `migrate` harness mode.** Every fixture up to current, asserting the
  documented empty-reads: a v10 island's graves at `vn:0`, a v9 island's
  `loreN` empty with places still named, a v11 island with no songs and
  27-field people.
- [ ] **Write down what a new field costs.** Four lines in the handoff
  convention: append to `packP`, add the hop, add a fixture, bump `SAVE_V`.

*Leans on:* `js/save.js` end to end, `js/main.js`'s boot path,
`test/harness.mjs`'s `save` mode and the six sprint modes that carry
forgeries. *Save:* this phase **is** the save format — no new fields, no
version bump, byte-identical output for a current island (assert it). *Model:*
**Claude Fable 5.1** — a schema everything downstream inherits, refactored
under a test suite that can only see whole islands.

## Phase 4 — A saga somebody who wasn't watching can read

**The chronicle is the best thing the island makes and it leaves as
monospaced plain text.**

`exportChron()` writes a `.txt`: a title, an island id, `YEAR n — the year of
the fever` headers, and every entry as `day 47   …`. The in-page panel is
three lines of string concatenation into `innerHTML`. Meanwhile the island
has, by year ten, named years, grown stories marked "as it is told now", named
ground with stone counts, songs with the names of everyone carrying them, a
hill with visit counts, and things with the hands they passed through — none
of which survives the export. This phase makes the record worth sending to
somebody, which is the same as making the island worth sharing.

- [ ] **The chronicle panel earns its typography.** Year headers with their
  names, grown entries visibly grown, songs and lost songs set apart, a
  song's carriers listed. `css/hearth.css` and `renderChron()`; no new state.
- [ ] **A saga export that is a page, not a dump.** One self-contained HTML
  file — years, names, entries, and four appendices the island already knows:
  the people, the stones and their counts, the named places and their cairns,
  the things and their hands. Zero dependencies, opens from a download folder.
- [ ] **Keep the `.txt`.** It is 14 lines and somebody will want it.
- [ ] **The link goes in the saga.** The export carries the island's hash, so
  a chronicle is one click from the island it came out of.
- [ ] **A harness assertion on the export.** Generate on a depth-run island,
  parse it back, check the year names, grown markers and song knower lists
  against `chron`, `songs` and `yearName()`.

*Leans on:* `js/save.js` (`renderChron`, `exportChron`, `saveHash`),
`css/hearth.css`, `js/core.js`'s `yearName`. *Save:* none — every fact
rendered is already packed or derived. *Model:* **Claude Opus 5** — rendering
and layout over state that already exists.

## Arc two — the world past the shore

Arc one gives the island time and a voice and a record. Arc two gives it
somewhere else to be, something to be afraid of, and children who visibly play
— then hands the whole thing to a machine that will notice when it breaks. The
first two phases are the ones that change what the island *is*; the last two
are the ones sixteen sprints of leftovers have been asking for. Same terms as
arc one: ranked by impact, order is the recommendation, the model convention
above carries forward unchanged, and a phase is finished when its PR has
merged with CI green and its handoff names the next phase and its model.

## Phase 5 — The far island becomes a place

**There is a second island on every horizon, and the only thing that has ever
happened there is that somebody didn't come back.**

`farIsle` is `{x, w, h, lit, k}` — a silhouette, a one-way voyage roughly once
per island, and a light that comes on if the voyager stays.
`LORE_PLACE.stayed` already names "the shore that faces the far island" on the
near side. The trade boat comes once a season, is waved at, and leaves. Both
are the same missing thing: the island has no elsewhere to be in relation to.
This phase gives it one without letting the camera leave home — the far island
stays a silhouette, and everything about it arrives by boat, in prose.

- [ ] **The voyage comes back with something.** A returner already walks into
  the hall before anywhere else (the heirloom rule); let them bring news, a
  thing, a song the far island had, or a person. Each is an existing system
  taking one new input.
- [ ] **The trader trades.** Wood and the granary against something the island
  cannot make. `granary`, `wood` and `things[]` are all there; the trade is
  four numbers and a chronicle entry, and the wave already happens.
- [ ] **Migration both ways.** `leave()` already puts a hungry person in
  `gone[]` and drops their heirloom on the shelf. Let the far island be where
  some of them go, and let `gone` people be who the returner brings.
- [ ] **Two islands, linked by their hashes.** An additive `fi` record holding
  the *other* island's seed, so island A's link can name island B and vice
  versa. Deliberately not a simulation of the second island: a name, a seed,
  and what came across the water.
- [ ] **A `wider` harness mode.** Force a return with cargo, a trade, a
  departure to the far island, and a hash round-trip of the link record — with
  soak audits at zero throughout, since every one of these moves a person or a
  boat.

*Leans on:* `js/life.js` (`voyage`, `boatArrive`, `leave`, `gone`, `things`),
`js/watcher.js`'s chronicle entries, `js/save.js`. *Save:* an additive `fi`
record on Phase 3's ladder; an island without one reads as it does today.
*Model:* **Claude Opus 5** — existing systems taking new inputs, on a save
ladder Phase 3 has already made safe.

## Phase 6 — Scarcity that bites

**Nothing on this island is ever really at stake, and everyone is unfailingly
nice about it.**

Hunger slows work and eventually puts somebody in a boat. Fever is an arc that
makes people `sick` and sometimes kills them. Storms flatten a field and take a
tree. That is the whole of adversity and it is all weather — nothing is
anyone's *fault* and nothing anyone does makes it worse. Rivalry is a
relationship label with three flavor lines attached. This phase gives the
island failure modes with people in them, and it is the most dangerous phase
here: every one of these moves people, and the soak invariants (nobody in the
water, nobody NaN, every mover on land) are the only thing between "a village
under strain" and a broken island.

- [ ] **A famine with decisions in it.** When the store will not last the
  winter, somebody has to say so. Rationing that slows everyone, a granary
  raid that costs a relationship, an elder who eats less on purpose — each a
  state change with a chronicle entry, all of them reversible in spring.
- [ ] **Illness that spreads on the paths.** `p.sick` exists and is set by the
  fever arc; let proximity carry it, let the chapel or the hall matter, let
  nursing become a relationship. Prayer already has `heal` at the top of its
  priority list and nothing to do.
- [ ] **A feud that is a system, not a label.** Two rivals whose work suffers,
  who avoid each other's spots, whose children inherit the distance — and
  which ends, at a fire night or a death or a walking of the bounds, with a
  chronicle entry either way.
- [ ] **Every new state packs, and every new state has an off-ramp.** No
  permanent debuff; the island's register is that things pass. A famine that
  never ends is a bug.
- [ ] **Soak first, then features.** `soak --days 40` and `nan --days 400`
  after each of these, not at the end. The nan mode's starvation windows exist
  for exactly this phase and have never had a real customer.
- [ ] **A `strain` harness mode.** Force each system, assert its chronicle
  entry and its recovery, and assert zero water/NaN violations across a 40-day
  famine on two seeds.

*Leans on:* `js/sim.js`'s task switch, `js/life.js`'s `newDay` and arcs,
`js/watcher.js`'s `faithDay`, `js/flavor.js`'s grammar. *Save:* additive
fields for the new person and village states, on Phase 3's ladder. *Model:*
**Claude Fable 5.1** — new rules moving people through a simulation whose only
safety net is a headless soak, where a wrong answer looks like a village
having a hard year.

## Phase 7 — Play that reads as play, and four other leftovers

**Five sprints have each ended by naming the same small things, and no sprint
has ever been the one to fix them.**

None of these is big enough to be a sprint and all of them are cheap. Together
they are the difference between an island that is correct and an island that
looks correct. Take them in one pass, with the harness modes they touch.

- [ ] **Ring-around that reads as a ring.** Children circling the swing or the
  fire ring share an angle step of `.9` and nothing else says so. A
  held-hands line between adjacent walkers, or a shared phase so they move
  together rather than independently around one point.
- [ ] **Elders and children, actually.** The `.05`/day roll wants an elder, a
  child of five and a dead acquaintance, and fired zero times in 240
  island-days. Raise it, or widen "acquaintance" to anyone the elder outlived
  — then check it on a Phase 2 decade run rather than by feel.
- [ ] **Prayer that is not a priority list.** Weight the eligible kinds by how
  badly the island needs each and let the dice pick, instead of the
  `heal > rain > food > calm > dream` if/else in `faithDay()`.
- [ ] **The most-visited stone, and the pop cap decided out loud.** `gr.vn`
  counts into the hundreds and feeds nothing but pixels — one flavor template
  closes sprint 15's leftover; and `popCap()+1` in the birth rule either
  changes or gets written down as deliberate, so it stops being re-noted.
- [ ] **Re-run everything.** All of this touches `R()`: determinism on both
  seeds, soak, and the affected sprint modes.

*Leans on:* `js/sim.js`'s `play` case, `js/life.js`'s `newDay`,
`js/watcher.js`'s `faithDay`, `js/flavor.js`'s `G`. *Save:* none. *Model:*
**Claude Opus 5** — small, local, well-described changes with existing tests
around each.

## Phase 8 — Hearth gets a machine that watches it

**Sixteen sprints of regressions have only ever run on somebody's desk.**

`.github/workflows/` carries a CI for the School Generator and one for Numina
and nothing for Hearth. Every "harness green" claim in every handoff is a human
having run eleven commands and pasted the output. The harness is excellent,
completely unautomated, and the only test this project has.

- [ ] **`hearth-ci.yml`, pathed to `Projects/hearth/**`.** Follow
  `school-generator-ci.yml`'s shape: `on: pull_request` and `push: main`,
  concurrency group, `defaults.run.working-directory`.
- [ ] **A PR gate that finishes in minutes.** `determinism`, `save`, and
  `soak --days 12 --seeds 7,20260819 --random 0`, on a pinned Playwright with
  its own Chromium installed — the School Generator's CI comment on why a
  pinned browser matters is worth reading before choosing the number.
- [ ] **A nightly or on-demand deep run.** `soak` at full 40 days, `nan`,
  `depth`, and every per-sprint mode, so the slow truth gets told without
  holding a PR open.
- [ ] **Determinism against a committed hash.** The handoffs record `pack()`
  hashes per sprint; commit the current pair so a shifted `R()` draw is caught
  by the machine rather than by the next sprint's regression.
- [ ] **Answer the board questions while here** — a `hearth` entry in
  `Tools/board-check/games.mjs` and an `assets/previews/hearth.jpg`, if Devon
  wants them.

*Leans on:* `test/harness.mjs` unchanged, `.github/workflows/`,
`Tools/board-check/`. *Save:* none. *Model:* **Claude Opus 5** — CI wiring
against an existing suite and an existing workflow to copy.

## What this leaves for a later arc

- **A second island that actually simulates.** Phase 5 keeps the far island a
  name and a seed on purpose; running two worlds at once is a different
  project with a different budget.
- **The watcher having a history.** `faith` and `acts` track what the watcher
  does and no phase here shows the watcher that account. Deliberate — the
  ambiguity is the feature, and a UI for it would read as a score.
- **Pure modules with unit suites.** The long answer to "no test can tell you
  a function is wrong" is extracting the rules engine from `sim.js` and
  `life.js`. It is also a rewrite of the two files every phase above touches,
  and it should follow the arcs, not precede them.
- **Art past the pixel budget.** Interiors, seasonal building states, a real
  night palette. Sprint 15 removed the size ceiling and no sprint has spent
  it.
- **Anything that needs a server.** Every phase above runs in the page, from
  `file://`, with zero offsite requests, which is the constraint the whole
  board holds.
