# Hearth — Feature Wishlist

**Status: sixteen sprints and Phases 1 through 6 are shipped.** Phase 6 was a
2+ and took three sessions, one system each: the short winter, the illness that
walks the paths, and the feud that is a system rather than a label. Phase 7 is
next, and it is a 1. Phase 2 gave the island a generational speed and then found that
three of the four systems it was meant to reach could not have fired at any
length of run; Phase 3 turned eight versions of `||` defaults into one
`migrate()` and one version gate; Phase 4 gave the chronicle a page to leave as;
Phase 5 gave the horizon a seed, a name and a boat that goes both ways; Phase
6 gave the island a winter it can be short of, a sickness that travels, and two
people who are not speaking. The
harness has sixteen modes now: the eleven that were there, plus `decade` (35
game-years x 2 seeds, ~40,000 audits, and the fast path asserted bit-identical
to 1x), `migrate` (every save shape v5 through v16 forged out of one live island
and walked back up), `saga` (400 days on seed 7, the export generated and then
read back off the DOM claim by claim), `wider` (the far island, from the
involution to a second tab opened at its own link) and `strain` (the short
winter, the sickness and the feud, each forced through its own entry points and
then lived through unforced for forty audited days on two seeds).

**What Phase 1 left:** the
songs a sound — `songDegrees(ci)` derives a 6–10 note phrase from the island
seed and the story's own chronicle index, and `songTune(sg, voices)` plays it
at the fire, twice, through `sfxG`. Nothing was added to the save. The
listening pass in `harness.mjs twelve` now measures the tune alongside the
other thirteen one-shots, and two runs of a seed are asserted to hum the same
phrase. Sprint 16 closed green across
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
whole world LZ-compresses into the URL hash, so an island is a link. Since
Phase 1 there are fourteen one-shots: the fourteenth is a song, and it is the
only one whose notes are a function of the seed.

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

- **`js/core.js`** (392) — the seeded rng (`mulberry`, `R`, `rnd`, `pick`,
  `hash`, `noise2`), every world constant (`W=110,H=70,T=8,YEAR=20`), every
  piece of top-level mutable state, `newWorld()`, terrain painting, the
  `say()` log, the people primitives, and the tables everything else reads:
  `GROW` (24 story kinds that can grow), `LORE_PLACE` (8 kinds with ground
  under them), `BLD`, `TRAITS`, `MADEV`/`MADE`, `yearName()`.
- **`js/flavor.js`** (276) — the log grammar. `G` is **226** condition/template
  pairs; `flavor()` builds a ~90-key context per call, filters, weights,
  picks, and refuses a template already used today.
- **`js/life.js`** (543) — `newDay()` (the once-a-day roll for arcs, births,
  partnerships, deaths, the bounds, elders telling children of the dead),
  `die`/`leave`/`remove`, `loseSongs`, `chatNews`, the building ladder, boats,
  `WORKS`, and the wildlife.
- **`js/watcher.js`** (290) — clouds, the blessings, dreams, `tellStory()`
  (the fire night, where stories grow and songs are composed), `boundsOut()`
  (the rite), the year's fortunes (`arc`), the four `WAYS`, the faith/prayer
  account, and the weather machine.
- **`js/sim.js`** (284) — one function, `step(dt)`: weather, snow, drought,
  crops, arrivals, and the per-person task switch (chop, till, harvest, fish,
  build, carry, gather, play, tag, snowman, bounds, pilgrim, mourn, …).
- **`js/render.js`** (297) — `drawFace()` (the 16×16 procedural portrait), the
  person card, and `draw()`: one 880×560 canvas, a terrain layer repainted
  only when `paintedKey` changes, a painter's-algorithm `ents[]` sorted by y.
- **`js/audio.js`** (153) — the graph, built once in `startAudio()`:
  `master → {ambG, sfxG, musG}` with wind, waves, rain (straight to master,
  because it is what everything ducks under), a spring, crickets, and a
  two-oscillator pad retuned by season. `note(f,dur,vol,type,pan,bus,when)` is
  the one-note primitive; `knock()` is the one-shot primitive.
- **`js/save.js`** (304) — the chronicle panel and `.txt` export, the LZ codec,
  and `pack()`/`unpack()`/`loadHash()`/`saveHash()`.
- **`js/main.js`** (174) — time controls, hints, input and the view, the boot
  sequence, the RAF loop, and `window.__hearth`, the object the harness drives
  the game through.

That is 2,713 lines of JavaScript. The load-bearing habits: **there is no
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
`test/harness.mjs`, which drives the real page in Playwright's Chromium through
`window.__hearth`, pausing the RAF loop first so every `step()` comes from the
test file. Seventeen modes live in it as top-level `if (mode === '…')` blocks:
`soak`, `nan`, `depth`, `determinism`, `save`, `decade`, `migrate`, `saga`,
`wider`, `strain`, `leftovers`, and one per sprint, `eleven` through `sixteen`. It is a good harness. It is not a
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
- **There is one version gate, and one ladder.** Phase 3 folded the two copies
  of `o.v>=5&&o.v<=12` — `loadHash()` and the autosave boot path in
  `js/main.js` — into `canLoad(o)`, over `SAVE_MIN` and `SAVE_V`. Grep `o.v>=5`,
  expect no hits. A new field costs four lines: append the slot or key to
  `pack()`, add a `{from,to,up,down}` hop to `LADDER`, add the version to
  `FIXTURES` in the harness, bump `SAVE_V`. The `down` half is not optional —
  it is what forges the fixture, and a hop without one cannot be tested.
- **Save changes are additive, and old saves read as empty, never as an
  error.** A packed person is a positional array of 32 slots (`packP`,
  indices 0–31) — append only, never reorder; new keys land as `o.foo||0`.
  Sprint 15's v10 forgery loads with every grave's `vn` at zero, and that is
  correct: the island tidied its cairns.
- **Version-pinned assertions in older harness modes are a recurring trap.**
  `thirteen` asserted `v === 9` and `fourteen` asserted `rt.v !== 10`; both
  broke on the next bump. Grep `rt.v !==` *and* `o.v !==` on every version
  move, and write new assertions as `>=`.
- **A behaviour change shifts the `R()` stream, and the stream is what every
  observational check is standing on.** Phase 2 moved three numbers and put four
  of the harness's own checks red — two of them genuine bugs the shift merely
  uncovered (an anniversary dropped twice over), and two of them checks that had
  been reading whatever the island happened to be doing: `twelve` measured its
  one-shots in whatever weather was overhead, and `sixteen` taught a song back to
  an adult. Pin the conditions a measurement depends on. A red check after a
  tuning change is a question, not a verdict.
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
  with starvation windows, ~5 minutes), `migrate` (every save shape v5–v16),
  `saga` (400 days, the chronicle export read back off the DOM, about a minute),
  `wider`
  (the far island: four cargoes, a trade, a departure, a return, the hash and a
  second tab opened at `#s=`, under a minute), `strain` (the short winter,
  the sickness and the feud: each forced through its own doors, then forty
  audited days on two seeds with ten invariants held every day, about two
  minutes), `leftovers` (Phase 7: the ring's shared phase, the widened elder
  roll, the weighted prayer and the most-visited stone's lines, each forced
  through its own door, under a minute), `decade`
  (35 game-years × 2 seeds, ~6 minutes, and the generational speed asserted
  bit-identical to 1×), and the per-sprint regressions by name, `eleven`
  through `sixteen`. `package.json` scripts only the first four. `decade` and
  `nan` are the slow ones and `decade` is the one to run after any change to
  `step()`, `newDay()` or `tellStory()`; everything else is under a minute. Chromium
  launches with `--autoplay-policy=no-user-gesture-required` always and falls
  back to `/opt/pw-browsers/chromium` when Playwright's own download is
  absent.
- **The far island's seed is an involution, and that is load-bearing.**
  `farSeed(s) = (s ^ 0x5f1a1e) >>> 0`, so island A's horizon is island B and
  island B's is island A out of one constant and nothing stored in a pair. It is
  derived in `newWorld()` with **no `R()` draw**, for the same reason `temper`
  and the aurora are: an old link has to keep its exact terrain. `#s=<seed in
  base 36>` opens a fresh island at a seed, and is checked before `loadHash()`'s
  length gate, because a seed link is far shorter than a packed island and would
  otherwise fall through to the autosave.
- **`gone[]` carries `far` now, and the row is two slots wide.** `go` packs as
  `[name, far]`; the v12→v13 hop widens it and its `down` narrows it again. A
  gone person who does not know which way they went cannot be brought back by
  the right boat.
- **Every sprint ends with a handoff file in the project root** in the same
  five sections: a 5-line changelog, measured numbers, decisions made without
  asking, complications hit, and quality-bar leftovers for the next sprint.
  Phases here end the same way — that leftovers list is what made the last
  four sprints possible to start.

## Questions for Devon

- ~~**Should Hearth join the board's regression suite?**~~ Answered by
  Phase 8 (#84): no. `npm run games` is a headed desk run and an entry there
  would be a shallower copy of the harness's `save` mode, which CI now runs on
  every PR. The preview image is still wanted; it is parked with the
  social-tag cleanup, because promoting one touches `index.html`, `assets/og/`
  and a social block this page does not yet have.
- ~~**Does Hearth get a CI workflow?**~~ Answered by Phase 8 (#83):
  `hearth-ci.yml`, a PR gate of `determinism` + `save` + a twelve-day `soak` +
  `pinned`, and a nightly matrix of the other fifteen modes.
- **Does the name-recycling quirk stay a feature?** Songs live on names
  (`songs[].kn` is a list of strings) and the ancestor-naming rule can hand a
  newborn a dead knower's name, so that child "knows" every song the ancestor
  knew and can resurrect a lost one. Rare; reads as poetry; fixing it means
  packing knower identity beyond names. Keep, or pay for identity?
- ~~**Does the population cap overshoot actually grate?**~~ Answered by
  Phase 7 (#82): kept, and named `BIRTH_OVER` with the reason beside it. A
  boat has to find a bed; a baby is born into its parents' house.

## The standing backlog

Everything below is open and *unclaimed by any phase in this file* — the
sixteen handoffs' other leftovers (the missing song tune, the elder roll, the
prayer priority, the most-visited stone, ring-around, the far island, the
migration ladder, the missing CI) are claimed by Phases 1–8. Pull from here,
and add to this list rather than starting a new one.

**The island's memory**
- **The teller has to be an elder, and this island rarely makes one.** Phase 5
  measured it while chasing a red `decade`: on seed 7, somebody aged sixty is
  alive on **57 days out of 700**, and on `main`'s stream of the same seed, 255
  — one to three individuals either way. "An elder who knew somebody under a
  stone tells a child about them" is the only durable record that generation
  leaves, and it fires about once per thirty-five game-years because its teller
  pool is empty most of the time. The fix is not the 5% roll; it is who may
  tell. A grown adult who knew the dead can do it, with an elder preferred.
  Phase 5 did not take it — it is a behaviour change to a sprint-16 system and
  would have shifted the stream a third time in one session — and `decade` now
  states the opportunity count every run (#67) so it stays visible.
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
- No preview image. Phase 8 decided against a `Tools/board-check/games.mjs`
  entry (#84); the 330×200 capture waits for the social-tag cleanup, since
  promoting one also writes `assets/og/hearth.jpg` and this page's og block.
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

## Phase 1 — Songs you can hear — **SHIPPED**

**The island composes music, names it, teaches it, mourns it when the last
person who knew it dies, and you never hear a note.**

Sprint 16 built songs completely except for the sound and said so on purpose:
"a real melody system is its own sprint with its own listening pass." This was
that sprint. Everything it needed existed — `note()` takes a bus and a `when`,
`KEYS` holds a root and a five-note scale per season, `wayTune()` was the
working precedent for a short phrase scheduled ahead on `sfxG`, and
`songs[].ci` was already a perfectly good melody seed.

- [x] **`songTune(sg)` — a phrase from a song's own identity.** `songDegrees(ci)`
  runs its own mulberry stream off `seed ^ (ci+1)*2654435761` — never `R()`, so
  the sim's stream is untouched and a shared link hums the same phrase. 6 to 10
  degrees over two octaves of `KEYS[sea()]`'s five, walked with steps of ±1 and
  ±2 and **reflected** at both ends rather than clamped: the first version
  clamped, and clamping parks a phrase on the bottom note and calls it a tune —
  the first seed it was asked for came out `0 1 0 0 0 0 1 2 0`. The last note is
  the root of whichever octave the phrase ended in, so it comes home. 199 of the
  first 200 seeds produce a distinct phrase.
- [x] **Fire nights only, and only the moments that already print prose.** Three
  call sites and no others: the composition night in `tellStory`, an older song
  started near the end of a telling, and the returner in `life.js` whose line
  already said "It is sung twice" — which is exactly what `songTune` does.
  Nothing hums at work.
- [x] **Voices, not one oscillator.** Pass one is the composer alone on a
  triangle; on pass two up to four voices come in on sines, detuned 0.3% and
  spread across the stereo field, one `note()` per voice per degree scheduled
  with `when` on `sfxG`. It peaks at 0.103 on the master analyser, between
  `lullaby` (0.100) and `wayTune` (0.106).
- [x] **A lost song is silent, and that is the design.** `songTune` returns
  `null` for a lost song and schedules nothing. The harness measures that on the
  same analyser rather than taking the return value's word for it.
- [x] **Extended `harness.mjs twelve` rather than adding a mode.** The tune is
  the fourteenth row of the same `AnalyserNode` table. Adding it exposed a real
  weakness in the duck assertion next to it: **Chromium only advances an
  `AudioParam`'s automation while the node is actually processing**, so a silent
  `sfxG` freezes `gain.value` wherever the last audible thing left it — the
  reading was 0.711 for "clear" when the gain the game applies is ~0.99. The
  duck now settles with something cheap flowing through the bus, and asserts a
  band (0.70–0.75 storm, 0.94–1.00 clear) rather than a measurement to three
  decimals. Two runs of seed 7 are asserted to produce identical degree
  sequences, and seed 8 to produce different ones.

*Leans on:* `js/audio.js` (`note`, `KEYS`, `wayTune`, `sfxG`),
`js/watcher.js`'s `tellStory`, `js/life.js`'s `loseSongs`. *Save:* none — the
tune is derived from `sg.ci` and the seed, the way `yearName()` is derived
from the chronicle. *Model:* **Claude Opus 5** — synthesis in an established
pattern with a measurement pass that already exists.

Broken on purpose, three times, each watched to fail first: a lost song given
its tune back (the measured silence check caught it, not just the return
value), the phrase's first degree drawn from `Math.random()` (the two-run
assertion caught it), and the resolving note commented out.

## Phase 2 — Decades, not years — **SHIPPED**

**Four of the island's best systems have never happened on their own, because
nobody has ever watched one of these islands grow up.**

All four happen now, unforced, on both fixed seeds. Getting there took two
things, and only the first was the one the plan expected. A decade had to be
reachable — that part was a profiling job and it came out easier than feared.
Then, with a decade reachable, three of the four systems turned out not to fire
at *any* length of run: they were gated on things that could not happen. The
first 700-day run measured, on seed 7, one grown story in thirty-five years, one
named place where the walking of the bounds needs two, and a song known by
forty-seven of the island's forty-eight people, which is a song that can never
be lost by anybody dying.

- [x] **A generational speed.** `FAST=240`, a fourth button in the time control
  reading **years**, and `y`. `loop()` split into `loop` and `frame(dt,run)` so
  the harness can drive real frames; at FAST a frame runs 240 `step()`s and
  paints on every fourth, which is about half a second a sim-day at 60 fps, or a
  decade in two minutes against forty minutes at 10×. `audioTick` runs on the
  paint cadence with the accumulated dt; hints do not run at all, because they
  are for somebody who has just arrived and this is not their speed.
- [x] **Profile a 500-day island first and write the number down.** Seed 7, day
  501, pop 52: **`step()` 0.0204 ms, `draw()` 9.2 ms.** Drawing is 450 times the
  cost of simulating, which is the whole finding — the way to a decade is not a
  faster simulation, it is a rarer paint. `pack()` 1.1 ms, `JSON.stringify` 1.3
  ms, `lzEnc` 26.4 ms on a 144,686-byte save, and that last one is a dawn
  autosave, so at FAST it writes every tenth day and once more on the way down.
- [x] **Bound what grows without bound.** The save at day 501 was 42% people
  (`pe`, and 83% of that is `hist`), 37% chronicle, and **12% stumps** — 1,102 of
  them, in 17,677 bytes, lying several deep on ground that has been worked for
  twenty years, and nothing in the simulation has ever read one. Stumps cap at
  240 and the oldest go back to grass (2,881 bytes at day 701). A person's `hist`
  caps at 60, keeping the first line, which is how they came to be here. The
  chronicle is left whole and paid for: it is the island's point. Both caps are
  applied where the world changes, not in `pack()`, so a link and a straight run
  look the same, and both are asserted in `decade` rather than eyeballed.
- [x] **A `decade` harness mode.** Thirty-five game-years on two fixed seeds, not
  the twenty the plan asked for: the first natural handing-down measured at day
  459, 469, 481 and 619 across four runs, because a thing is made by whoever
  first masters a craft and that person then has to live out a life before it can
  pass to anyone. The island's first heirloom is a year-23-to-32 event. 700 days
  × 2 seeds, ~40,580 full-cast audits, **0 violations**, 4.5 minutes.
- [x] **Determinism across the fast path.** Two fresh copies of seed 7 driven
  through real frames, 33,600 frames of one step against 140 frames of 240, same
  dt, same total: pack hash `582e414:17608` both ways. `draw()` and `audio.js`
  have never drawn from `R()`, which is why this works, and the assertion is
  there so that stays true. The one thing legitimately different is `sp`, the
  speed the watcher left it at, which `pack()` carries.
- [x] **Then re-tune what the decade exposes.** This was most of the work.
  **The fire.** One night a year, at midwinter, is twenty-six tellings against
  five hundred chronicle entries, and sprint 12's teller samples five entries at
  fixed fractions of the whole chronicle — so every pick except the first slides
  onto a different entry each time something new happens, and only the first,
  which sits at fraction zero and never moves, ever reached the three tellings a
  story needs to grow. Two changes: the other three seasons get a fire night at
  0.4, and the teller comes back to the most-told story that has not grown yet
  (0.45), which is the counterpart of the line above it that comes back to one
  that has. **Stories grown over thirty-five years went 1 → 31 and 3 → 30; named
  places 1 → 4 and 2 → 4, and the bounds now walk on both seeds** (first at day
  264 and day 564).
  **The song.** Sprint 16 built a song that could be lost and then handed it to
  every pair of ears on the island. Carriers are the ones with a tune in them
  now (`musical`), plus whoever made it; an airing teaches the children with the
  ear, not every musical adult present, which was the thing topping the carriers
  back up faster than anything could thin them; and `sg.d` is the night it was
  last sung rather than the night it was made, which `forgetSongs` counts from —
  three years unsung and it starts slipping, at .28 a year from the musical and
  .55 from anyone else. **Songs went from 47 knowers out of 48 people and none
  ever lost, to 6 and 7 songs carried by 2 to 7 people each, of which 4 and 2
  have been lost** (first at day 521 and day 661).
  **The telling of the dead.** The `.05`/day roll was fine; the selection was
  not. It picked an elder blind and *then* asked whether they had known any of
  the dead, so most days it landed on somebody with nothing to tell, and it only
  wrote the telling into the child three times in ten — which left a system with
  almost no durable trace at all. Thirty-five years produced 2 and 0. Elders who
  knew somebody are the ones picked now, and the child keeps it, because what
  the child keeps is the only record there is. **3 and 1.**
  **The anniversary of a death** was being dropped two ways, both found by the
  same 22-day check going red under a shifted stream. It skipped anybody already
  mourning, so a widow who happened to be up the hill for her own reasons on the
  day itself got no line for it; and it asked "is anybody by that name alive",
  which on this island is not the same question as "is the one they lost still
  alive" — names recycle, and a widow whose new daughter had been named for her
  dead husband read as not a widow. A living namesake was born after the stone
  went up, and that is now the test.
  **Left alone, with the number:** the 60% bounds chance and the 25% repeat-walk
  rate both measure fine — "where the boat first came in" was walked seven times
  by day 401, which is the cairn's top tier, so the tiers are reached too.

Two of the harness's own checks were re-pointed rather than relaxed, because
phase 2 moved what they were aimed at. The listening pass in `twelve` measured
its one-shots in whatever weather the island happened to be in, and rain goes
straight to the master bus by design: the room floor read 0.1616 instead of the
0.0557 every threshold in the pass was written against, and a perfectly audible
song failed for being only 1.17 floors loud. It pins the sky clear first now,
and reads 0.0567 floor against a 0.1060 song, which is the number phase 1
recorded. And `sixteen`'s "the fire teaches the song back" pulled an adult out
of the carriers; the fire teaches the children now, so it pulls a child.

*Leans on:* `js/sim.js`'s `step`, `js/main.js`'s loop and `setSpeed`,
`js/save.js`'s `pack`, `test/harness.mjs`'s `depth` and `soak`. *Save:* none —
the two caps change how much `pack()` writes, never what shape it writes, so no
version moved and Phase 3's ladder inherited nothing. *Model:* **Claude Fable
5.1.**

Broken on purpose, four times, each watched to fail first. `draw()` given one
`R()` call: the fast-path hashes split at once — `bf652769` against `452ea1d0`
— which is the point of asserting by hash rather than by argument. `STUMP_MAX`
raised to 1e9: 14,797 bytes of stumps against a 3,600 ceiling. `trimHist` made a
no-op: a life story 67 lines long. And the airing put back to teaching every
musical adult present: seed 7 went thirty-five years without losing a song, the
exact state the phase started from. The `STUMP_MAX` break also turned up a trap
in the fast-path check itself — a `--fastdays` that does not divide into whole
FAST frames left the fast run one part-frame ahead and reported a divergence
that was arithmetic. It rounds up to a whole number of frames now, and passes at
1, 7 and 12 days.

## Phase 3 — The migration ladder — **SHIPPED**

**Eight save versions are handled by `||` defaults scattered through one
sixty-line function, and there is no way to test a single hop.**

- [x] **`migrate(o)` — one function, one hop at a time.** A `LADDER` of seven
  entries, `{from, to, up, down}`, applied in order until `o.v` is current.
  `unpack()` calls it first and then reads only the current shape: there is no
  `o.v` test anywhere below that line, and no `o.ln||[]`, `o.lp||[]`, `o.sg||[]`,
  `o.sm||[]`, `o.hl||[]` or `o.wk||[]` either. The `||` that survive are the ones
  on values that are legitimately falsy — `o.sp||1`, `o.dr||0` — not on shapes.
- [x] **One version gate, shared.** `SAVE_V=12` and `SAVE_MIN=5`, and one
  `canLoad(o)` that both readers call: `loadHash` here and the autosave boot path
  in `js/main.js`. `pack()` writes `v:SAVE_V`. Grep `o.v>=5`: no hits.
- [x] **Move the forged saves into fixtures.** Better than fixtures: `down` is
  `up` walked backwards, so `forge(o,v)` builds a v5-through-v11 save out of a
  live one using the same table the migration reads, and a hop cannot be added
  without its inverse. This is what the six inline forgeries could not do — they
  were each written by hand against the ladder that existed on the day of their
  sprint, and the v7 one had already drifted, leaving the sprint-10 keys in a
  save that predates them.
- [x] **A `migrate` harness mode.** All seven shapes out of one island, each
  loaded and re-packed, each asserted against its documented empty reads: v11 no
  songs, no snowmen, `skipN` 0, 27-field people; v10 graves at `vn:0`; v9 `loreN`
  empty with places still named; v8 no named places at all; v7 no heirlooms and
  its one finished work back at `prog:99`; v6 `faith` 0. Plus the gate itself —
  `SAVE_MIN-1`, `SAVE_V+1` and a save with no people all refused.
- [x] **Write down what a new field costs.** Four lines, in the comment above
  `migrate`: append the slot or key to `pack()`; add a hop with its `up` and its
  `down`; add the version to `FIXTURES` in the harness; bump `SAVE_V`.

*Leans on:* `js/save.js` end to end, `js/main.js`'s boot path,
`test/harness.mjs`. *Save:* this phase **is** the save format — no new fields, no
version bump, and byte-identical output for a current island, asserted in
`migrate` as `pack → unpack → pack`. *Model:* **Claude Fable 5.1.**

Broken on purpose, three times — and **two of the three passed while broken**,
which is exactly why #34 says to watch the check fail before trusting it.

Reintroducing the sprint-12 bug by hand (`main.js` given back its own inline
gate, upper bound left stale at 11) was caught at once: the `save` mode's reload
came back at day 1 instead of day 4. The other two were not. Making the 10→11
`up` a no-op left the v10 fixture with 6-field graves; `unpack` read `a[6]` as
`undefined`, and every count downstream treats `undefined` as zero, so
"grave-visits 0" passed a ladder that was doing nothing at all. And lowering
`SAVE_MIN` to 4 was invisible because the gate check asked about `SAVE_MIN-1` —
a bound computed from the constant under test, so moving the constant moved the
assertion with it.

Both checks were rewritten before either caught anything. The mode now asserts
the migrated **shape** — 29-slot people, 7-wide graves, 8-wide works, 7-wide
chronicle rows, and none of the twelve keys the ladder fills left missing — and
derives its fixture list from `SAVE_MIN` and `SAVE_V` rather than listing it
beside them, with literal 4 and 13 at the gate. Re-broken: the no-op `up` reads
`shape 29/6/8/7` and fails; `SAVE_MIN=4` fails twice over, once because `forge`
cannot land on a v4 there is no hop for, and once because `canLoad({v:4})` comes
back true.

## Phase 4 — A saga somebody who wasn't watching can read — **SHIPPED**

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

- [x] **The chronicle panel earns its typography.** Year headers carry their
  name in the heading. A grown story gets a rule down its side as well as its
  "as it is told now". A story somebody set to a tune gets the tune's own line
  under it, in gold, naming who made it and everyone alive who still carries
  it; a lost song gets the same line greyed and says the tune is gone.
- [x] **A saga export that is a page, not a dump.** `sagaHTML()` builds one
  self-contained file: a header, a `section.yr` per year with its name, every
  entry with its day, and four appendices — the people (age, whether child,
  grown or elder, the craft epithet once mastered, traits, and the ones away
  over the water), the hill (each stone with the year, the age and the count of
  visits left on it), the named ground (each name with the stones on its
  cairn), and the things (each with whose hands it is in and every line of its
  history). One inline `<style>`, no scripts, no external reference of any
  kind, and a print rule that flips it to ink on paper. 104 KB on a 400-day
  island.
- [x] **Keep the `.txt`.** Untouched, down to the column padding. Both buttons
  now share one `dlFile()`.
- [x] **The link goes in the saga.** `islandHash()` came out of `saveHash()`
  and has two callers now: the keep button and the saga's header link (locked
  decision #62 says where that link points).
- [x] **A harness assertion on the export.** `node harness.mjs saga`, 400 days
  on seed 7, generates the page, loads it into a blank tab and reads every
  claim off the DOM — year headings against `yearName()`, grown days against
  `chron`, each song's composer and carriers against `songs` and the living
  cast, each stone against `graves`, each cairn against `loreN`, each thing's
  hand-count against `things` — plus zero scripts, zero external references,
  and a link whose hash comes back through `lzDec` and `canLoad` at the right
  seed and day.

*Leans on:* `js/save.js` (`renderChron`, `exportChron`, `saveHash`),
`css/hearth.css`, `js/core.js`'s `yearName`. *Save:* none — every fact
rendered is already packed or derived. *Model:* **Claude Opus 5** — rendering
and layout over state that already exists.

Broken on purpose, and **the first break passed.** Deleting the living-only
filter from `carriers()` outright left the mode green at 170 days, because at
day 171 nobody on seed 7 who had ever learned a song had died yet: the filter
was a no-op and the assertion around it was vacuous, which is #34's whole
point. The default run is 400 days now, and the mode refuses to pass unless at
least one song has outlived one of its carriers — along with a story grown, a
stone on the hill, a named place, a thing, and four finished years. Re-broken
at 400 days, the same deletion fails on two songs by name; dropping the `gr`
class fails with 17 grown stories claimed and none rendered; dropping the year
name from the heading fails on all 21 headings.

The 400-day run also turned up a real ordering bug in the check itself:
`songs` is in the order the songs were made and the saga renders them where
their stories sit in the chronicle, which on seed 7 is not the same order. The
mode sorts by `ci` now.

## Arc two — the world past the shore

Arc one gives the island time and a voice and a record. Arc two gives it
somewhere else to be, something to be afraid of, and children who visibly play
— then hands the whole thing to a machine that will notice when it breaks. The
first two phases are the ones that change what the island *is*; the last two
are the ones sixteen sprints of leftovers have been asking for. Same terms as
arc one: ranked by impact, order is the recommendation, the model convention
above carries forward unchanged, and a phase is finished when its PR has
merged with CI green and its handoff names the next phase and its model.

## Phase 5 — The far island becomes a place — **SHIPPED**

**There is a second island on every horizon, and the only thing that has ever
happened there is that somebody didn't come back.**

`farIsle` was `{x, w, h, lit, k}` — a silhouette, a one-way voyage roughly once
per island, and a light that comes on if the voyager stays.
`LORE_PLACE.stayed` already named "the shore that faces the far island" on the
near side. The trade boat came once a season, was waved at, and left. Both were
the same missing thing: the island had no elsewhere to be in relation to. This
phase gives it one without letting the camera leave home — the far island is
still a silhouette, and everything about it arrives by boat, in prose.

- [x] **The voyage comes back with something.** `farReturn()` runs off the
  return boat with the voyage's own chronicle index in hand. One weighted draw
  picks news, a thing, a tune or a passenger, and each is an existing system
  taking one new input: the news is the name (`farLearn`), the thing is a
  `things[]` row out of `FARGOODS`, the tune is a `songs[]` row against the
  voyage's own entry with exactly one name in `kn`, and the passenger is
  somebody already in `gone[]`. The tune is the good one: carried by one head,
  it goes out in the boat when that head leaves and comes back in it when they
  return, through sprint 16's machinery with nothing added.
- [x] **The trader trades.** `farTrade()` is four numbers — ten of timber and
  eight of meal out, one thing in, once a year at most — and the once-a-year
  gate is asked of `things[]` itself rather than a new counter. The wave, the
  talker who does the arguing and the store it is paid out of were all already
  there. The trader can also be the one who names the far island, which matters
  because the voyage happens once per island and may never happen at all.
- [x] **Migration both ways.** `leave()` turns the boat for the far island when
  the island knows its name and the person is brave, restless, or dreamt of it —
  read off the person rather than rolled, so it costs no `R()` draw and the
  character does the deciding. `p.far` packs, so the yearly kind-season return
  and the voyage's passenger both know which way somebody went. `comeBack()` and
  `comeBackKit()` came out of the old `return2` body unchanged, in that order,
  because the chronicle has always had the arrival written down before the shelf
  and the song.
- [x] **Two islands, linked by their hashes.** `fi` holds the far island's seed,
  the name this island calls it, whether that name has crossed, and up to 24
  crossings. `farSeed(s) = (s ^ 0x5f1a1e) >>> 0` is an involution, so the island
  the link opens has *this* one on its horizon and names it back — two islands
  that name each other out of one constant and no stored pair. `#s=<seed in base
  36>` is how it opens: a seed, not a save, because nothing over there has ever
  been simulated (locked decision #64). The saga grew a fifth appendix, "Over the
  water", carrying the name, the seed, the link and every crossing.
- [x] **A `wider` harness mode.** Ten sections. The involution and the record's
  shape; each of the four cargoes forced through `farReturn` by name and
  asserted on durable state; a departure that takes a tune with it and a return
  that brings it back; the trade refused 40 times inside its year and then made;
  a real voyage driven end to end through the sim — decided, walked down, rowed
  out, rowed back — to prove the boat is what calls `farReturn`; the whole
  record through `pack`/`unpack` byte-identical; and finally a second tab opened
  at `#s=`, which lands on the far island and finds this one on its horizon.
  Every day it runs is audited, and the violations are carried to the end.

*Leans on:* `js/life.js` (`voyage`, `boatArrive`, `leave`, `gone`, `things`),
`js/watcher.js`'s chronicle entries, `js/save.js`. *Save:* **v13** — an additive
`fi` record and a two-slot `go` row, one hop on Phase 3's ladder with its
inverse; an island without either reads as a horizon nobody has a name for.
*Model:* **Claude Opus 5**.

**What fought back.** The `R()` stream moved, as it always does, and put three
older checks red. All three were reading whatever the island happened to be
doing, which is the failure mode the conventions above already name — and one of
them was already red on `main`.

- **`fourteen`** asserted the child on the walking of the bounds gets the line
  "shown where everything happened". Sprint 15 gave the walk a second ending —
  when there are stones on the hill the child is "told who is under every stone"
  instead — and the check had been passing for two phases only because seed 7
  reached the bounds before anybody died. It now asserts the line the child
  always gets, with which of the two pinned to the hill **as `boundsOut()` saw
  it at launch**, not as it stands after the walked day, and it looks for both
  hist lines among the dead as well as the living: the elder the test forces to
  66 in order to have a leader is exactly the age that dies. Locked decision #66.
- **`sixteen`** looked for `year 1 — ` in the chronicle panel's HTML. That is the
  `.txt` export's format; the panel has written the year's name into a `<span>`
  since Phase 4 restyled it. **This one was already red on `main`** and was not in
  the backlog header's list of standing reds. It reads the heading off the DOM now.
- **`decade`**, twice, and the first time it was right. Its first red said no
  child on seed 20260819 was ever told about somebody under a stone in 35
  game-years. Measured, that was a real consequence of this phase: the trade's
  original 14-timber floor was a tax on the housing stock, and the island built
  24 houses instead of 28, sat at `popCap()` for 203 days of 700 with births shut
  off, and ran out of children. The floor is 34 now (locked decision #65) and the
  same island builds 31 houses and has children on 691 days of 700.

  The second red was not. With housing healthy, seed 7 still told nobody, and the
  measurement says why: **the island has anybody aged sixty alive on 57 days out
  of 700**, against 255 on `main`'s stream — which is not 700 samples but a count
  of how many individuals happened to live past sixty, so it swings wildly
  between two streams of the same game. A 5%-a-day roll on 26 eligible days
  produces nothing 26% of the time. `main` passes this seed with two tellings and
  113 eligible days; one stream over it is zero and twenty-six. `decade` counts
  the eligible days itself now and fails only when zero would have been a
  one-in-twenty surprise, printing both numbers either way (locked decision #67).
  Broken on purpose on seed 20260819, which gives it 171 eligible days: deleting
  the child's history line fails it with `no child was ever told about somebody
  under a stone, across 171 days that could have`.

Two things came out of that chase and are worth the next phase's attention.
`knewDead()` in `newDay` is one: "knew each other" was being asked of one side
only — an elder counted only if the *dead* person's `rels` named them, and those
lists cap at five or six entries — so the eligible-day count on seed 20260819
went from 64 to 171 by asking both. It is also what stops `pick()` being handed
an empty array, which the two hand-copied predicates it replaced were one edit
away from. The other is not fixed and belongs to whoever takes Phase 7: **the
teller has to be an elder, and this island rarely makes one.**

Broken on purpose, four times, each break watched to fail and then put back:

- packing `go` as `[name, 0]` instead of `[name, p.far]` — `wider` fails on
  `the gone came back as [Marobel:0], not [Marobel:1]`;
- packing `go` as a bare name again, one slot wide — `migrate` fails first on
  `pack -> unpack -> pack is not byte-identical at the current version`;
- making the v12→v13 `up` hop `o=>{}` — `migrate` fails on every shape below 13
  with `rows came up go 15/2` (a name read as fifteen slots of letters), `the
  ladder left fi missing`, and `a v12 save knew which way one of the gone had
  gone`;
- `farSeed` as `(s + FI_K) >>> 0` instead of `(s ^ FI_K) >>> 0` — `wider` fails
  twice, at `farSeed is not an involution: 7 -> 6232613 -> 12465219` and again in
  the second tab, where `the far island's far island is 12465219, not 7`.

## Phase 6 — Scarcity that bites — **SHIPPED**

**Nothing on this island was ever really at stake, and everyone was unfailingly
nice about it.** That is fixed, in three increments over three sessions.

**What shipped, in the third increment: a feud that is a system, not a label.**
A rivalry was two `rels` entries that four flavour lines read and nothing else
did; the raid made one on purpose and the thaw ended it three ways, and between
those two moments nothing on the island was any different for it. `feud` is now
a record on the shape `want` and `ill` already have — the day it started, the
two names, whether it has outlived a thaw, how many nights at the store it has
in it — with one door in (`startFeud`, which only the raid walks through) and
one door out (`endFeud`, which writes exactly one chronicle entry every time it
is called). While it lives the two work at `.8`; neither goes to a favourite
spot, the far shore or the market while the other is standing within four
tiles of it (`shunned`); the two never stop to talk on the path (`apart`); and
on a fire night either they end up on the same log or one of them does not
come down at all and the gap on the log is exactly one person wide. Their
children keep the distance without being told — a child of one side does not
follow the other side's work or chase its children — and a child who comes of
age inside it takes it up as a rivalry of their own, which the feud's ending
does not undo (#78). It ends five ways and every one is written down: squared,
at the thaw or a fire night or by somebody sitting up with the other one or in
a dream; walked, at the walking of the bounds, where the elder puts the two in
the same line behind the children and does not discuss it; parted, the morning
after a death or a boat, with the one left carrying both halves; and worn, at
`FEUDD` (40) days, where nobody can say what it was about any more and the two
stay rivals and the village stops counting it. A second short winter inside an
open feud is the same feud's doing — the same one at the store, the same one
who sees, the entry labelled `again` — so the raids and the endings account for
each other and `strain` holds them to it (#76). The standing question from the
second increment is answered: sitting up with the other one ends it, and the
feud's own door writes the entry rather than nursing's, so one night is one
entry (#77). Save **v16**: one key, one ladder hop with its inverse, and a
repair on every load that drops a feud naming somebody who is not there and
makes the two of them rivals both ways whatever else the save says. The
inspect card says *not speaking to*; four flavour lines, five growth lines for
the fire, and a year name.

Measured, forced: the two work at `.800` against `1.000` before it; the chance
to end it at a fire is `.40` plain, `.60` with somebody gentle, `.20` with
somebody stubborn and `.50` a year in; and the forced fire settled it on the
eighth night, with a gap on the log on each of the seven before. Unforced, over
sixty audited days on seeds 7, 20260819, 42, 11 and 99 with a famine put into
every winter: nine raids, one of them a second night at the store inside a
feud already open, started eight feuds, and every one accounts for itself —
six squared, none walked, none parted, none worn, two still open at the end —
with four of the eight outliving their thaw. The longest lived 21 days on seed
7; the two on seed 11 started and ended inside one winter night, at the fire,
without ever reaching a day boundary. The five islands came out at 31, 30, 27,
28 and 26 people, seed 99 with the store at 43, which is the leanest any of
them has been and still not a boat.

**Nothing else moved off its stream.** Every roll the feud adds sits behind
`if(feud)`, and only the raid opens one, so an island that has never been short
at the turn of winter draws the exact stream it drew before: `pack()` on seeds
7, 20260819 and 42 after forty days is byte-identical to the previous commit's
with the new key removed, and `soak`, `determinism`, `save`, `migrate` and every
sprint mode stayed on the islands they were checked against (#74, a third time).

**What shipped, in the second increment: illness that travels.** `p.sick` had
one setter and one clearer, both inside the fever arc, and a line at the top of
`newDay` that healed everybody the moment the arc was over. It is its own state
now. One door in (`takeSick`), one door out (`wellAgain`), a `sickD` on the
person saying when they took it and a `wellD` saying when they shook it off, and
an `ill` record for the wave they are part of — the day it started, who started
it, how many have taken it, how many times somebody sat up with somebody — on
exactly the shape `want` already had. The first day of it you are up and out and
working at `.45`, which is how it gets round the island; from the second day you
are in bed (task `abed`) whether you agree or not. It is carried by being within
**1.9 tiles of somebody who has it**, at `.004` a step per source, and that
distance is the whole mechanism: the fire, the market, the bell and the fire
night already put the island inside it without the rule having to name a
building. What the hall gets is the other half — with a hall and more than one
of them down, the sick are laid out along one wall of it where a single person
can sit with all of them, and the roll to get up is better for it. Somebody
comes to sit with them: their partner first, then their own people, then a
friend, then whoever is gentle about it, and **sitting up with somebody makes a
friend of a stranger and turns a rival back into a friend on purpose**, which
nothing else in this game does — the dream and the thaw both mend rivalries
without anybody deciding to. The cost needs no rule: sitting beside somebody
with it is being near somebody with it. And prayer's `heal`, top of its priority
list and idle since sprint 11, finally does something — a prayer standing on
somebody adds `.2` to their chance of getting up, on the same roll the weather
is on, which is the point of the quiet stone.

**It ends, and the ending is a number.** Nobody is in bed longer than `SICKD`
(6) days; a wave stops finding anybody new after `WAVED` (12); having had it
leaves you proof against it for `WELLD` (14), which is longer than a wave can
last and is what stops one wave going round the village twice. Multiply those
out and no wave can be more than 18 days old, on any island, ever — so `strain`
asserts it on every single day of a forty-day run, along with three more: nobody
in bed without a day to count from, nobody in bed past the six-day cap, and the
wave record and the people in bed agreeing with each other in both directions
(#73).

Measured: a wave forced on day 31 of seeds 7, 20260819, 42, 11 and 99 took 1, 1,
14, 22 and 9 people over 3 to 10 days — two of them never got out of the house
they started in and one went through all but one of the island, and the range is
the point. Over `strain`'s forty audited days with a wave forced into every
winter on top of the famine, seed 7 ran one wave (8 days
with somebody in bed, 4 of them at once at the worst, 13 people through it) and
20260819 ran two (12 days, 4 at once, 16 through the biggest), and both islands
came out at 20 and 23 people with the store above 80. The whole spread block
sits behind `if(ill)`, so an island with nobody in bed draws exactly the stream
it drew before any of this existed (#74) — which is why `soak`, `determinism`,
`save` and every sprint mode stayed on the islands they were checked against.

**What shipped, in the first increment.** The store is counted against the cold
season now, not against winter — the season line's 13 measures a head is what
five days of winter want, and nothing grows between the first frost and several
days into spring, so a store that has to cover the gap wants 19 (`COLD` in
`js/core.js`, and decision #68 for why the old number could never have fired).
At the turn of every winter, whoever keeps the store — the store-craft master if
there is one, the eldest if there is not — counts it, says the number out loud,
and the island goes onto rations: everyone works at `.85`, the store is drawn
down at `.62`, hunger creeps up and is capped at `.45` so a village that decided
to eat less does not lose more people than one that did nothing (#69). Inside
the famine two things can happen and both are somebody's doing rather than the
weather's. One person takes more than a share out of the store in the dark and
one person sees it, which costs four to six measures and costs the two of them a
great deal more; and an elder stands down from a measure, calls it not being
hungry, works at `.9` of the ration rate and fools nobody. At the thaw all of it
comes off — unconditionally, on the first day of spring, whatever the store says
— and the rivalry the raid made is squared, not squared, or left unsettled
because one of the two is no longer on the island, with a chronicle entry every
way (#70). Save is **v14**: one ladder hop with its inverse, `wa`/`wy` for the
famine and a thirtieth person slot for the one eating last. A short winter earns
the year its name. Eight new flavour templates, a `· rations` on the HUD, and
three new `GROW` entries so the fire can tell the story afterwards.

Measured: on seeds 7, 20260819 and 42 the store stood at 1.32–1.75 times the old
threshold at every one of thirty turns of winter and was never once short by it;
against the cold season's 19 it is short about one winter in four. Ten
game-years on seeds 7 and 20260819 give two short winters each, with raids and
elders eating last inside them, and pop 50/53 at day 201 against 52/48 before —
the island is leaner, not emptier.

- [x] **A famine with decisions in it.** Rationing that slows everyone, a
  granary raid that costs a relationship, an elder who eats less on purpose,
  each a state change with a chronicle entry, all reversible in spring.
- [x] **Every new state packs, and every new state has an off-ramp.** v14, and
  the off-ramp is the calendar rather than a roll.
- [x] **Soak first, then features.** `soak`, `nan` (5 islands, 2,000 sim-days,
  ~225,860 audits) and every other mode green after each piece, not at the end.
- [x] **A `strain` harness mode.** Each system forced through its own entry
  point and asserted on durable state, then a real reckoning at a real turn of
  winter, then forty audited days on two seeds with the thaw asserted on every
  single day.
- [x] **Illness that spreads on the paths.** Proximity carries it, the hall is
  where the sick are laid out together, nursing makes a friend and unmakes a
  rivalry, and `heal` is worth `.2` on the roll to get up. Save **v15**, one
  ladder hop with its inverse. The `eleven` distinction held: the arc is still
  told from the island's own by `d0`, and what that mode asserts now is the arc
  ending and the clock on everybody still in bed, because the wave outlives the
  arc on purpose and "nobody is sick afterwards" stopped being true.
- [x] **A feud that is a system, not a label.** Two rivals whose work suffers,
  who avoid each other's spots, whose children inherit the distance — and which
  ends, at a fire night or a death or a walking of the bounds, with a chronicle
  entry either way. The raid makes the pair and `endFeud` ends it, five ways,
  and `endWant`'s three endings were the shape copied.
- [x] **`strain` grows with them.** Three systems in, three sections added: the
  wave forced through `takeSick` (the record, the clock, the second day in bed,
  the roll asserted clause by clause against `illChanceOf`, twelve people put at
  the six-day cap at once so that the cap is proved rather than coincided with,
  and everybody held beside the one in bed for a day inside a single day's steps
  so that "it travels" is proved and no fever arc can have done it), and nursing
  forced through `nursedBy` (a rival pair and a pair of strangers, both ending as
  friends, both written down), and the feud forced through `startFeud` (rivals
  both ways and the work slowed, asserted on `workRateOf`; the shunned spot and
  the walked-off one; the fire-night chance clause by clause against
  `feudChanceOf`; a fire night called through `tellStory` until it settles,
  with exactly one of the two away from the fire on every night it does not;
  the bedside, the dream, the bounds, a death and the cap each through the
  function that ends it that way; the children on their sides, kept apart, and
  taking it up; and a round trip with both repairs). The forty-day run forces
  nothing for the feud — the raid inside each forced famine starts one at the
  roll a real island gets — and asserts four feud invariants a day beside the
  famine's two and the illness's four, then holds the raids to the endings.

**What this phase leaves.** Seed 7 barely makes elders, so the
elder-who-eats-last system fired zero times in ten game-years there against
twice on 20260819 — that is the same throttle the standing backlog names at the
top, and it is Phase 7's. **The stream moves whenever somebody is ill or two
people are not speaking**, and only then (#74): a run with nobody in bed and no
raid is on the old stream exactly, so if an older check goes red, first ask
whether that run had either, then read #66, #67 and #71, and do not treat a red
check as a verdict. The feud is only ever visible whole at a fire night; the
rest of it is a person taking the long way round, which the card says and the
map does not. And the seven guard-rails the third increment added were each
broken on purpose once (#34) — the fire-night branch, the cap, the rivals on
`startFeud`, the fire's chronicle entry, the work rate, the save repair and the
bedside door — and every one went red on the check written for it.

*Leans on:* `js/sim.js`'s task switch, `js/life.js`'s `newDay` and arcs,
`js/watcher.js`'s `faithDay`, `js/flavor.js`'s grammar. *Save:* additive
fields for the new person and village states, on Phase 3's ladder. *Model:*
**Claude Fable 5.1** — new rules moving people through a simulation whose only
safety net is a headless soak, where a wrong answer looks like a village
having a hard year. *The first two increments were worked under Claude Opus 5,
the third under Claude Fable 5.1.*

## Phase 7 — Play that reads as play, and four other leftovers — **SHIPPED**

**Five sprints have each ended by naming the same small things, and no sprint
has ever been the one to fix them.** This one was. None of them was big enough
to be a sprint and all of them were cheap; together they are the difference
between an island that is correct and an island that looks correct.

- [x] **Ring-around that reads as a ring.** The ring has one phase, `time*.3`,
  and each child's angle is that phase plus the slot their name sorts into
  over the children on the ring, so the circle turns as one and a reload lands
  it on the same turn (#79). A held-hands line is drawn between neighbours in
  `render.js`, presentation only, off two fields that are not saved.
- [x] **Elders and children, actually.** "Knew" is "outlived": an elder
  qualifies for any grave dug after they came ashore, the death day read off
  the grave, and the ones they actually knew are told about first (#80). The
  child has to have been unborn or under two that day, and the line the child
  keeps says which. The roll stays `.05`. Measured on the decade run against
  main's own islands with the same harness, the elder-side widening is small
  (92 of 92 elder-and-child days eligible on seed 7 against 90 under the rels
  rule; 199 of 284 against 168 on 20260819): Phase 5's symmetric `rels` had
  already done most of it, "zero in 240 days" was stale (main tells 3 and 4
  children in 700 days), and the throttle is the island making an elder at
  all — which the decade mode now prints beside the eligible-day count.
- [x] **Prayer that is not a priority list.** The kinds the island could ask
  for are weighted by how badly it wants each, "not today" is in the draw at
  `.3`, and one draw picks (#81). One sick and the ground at `.9`: heal 54,
  rain 46, dream 9, nothing 291 in four hundred asks, against heal 117 and
  nothing else from the list it replaces.
- [x] **The most-visited stone, and the pop cap decided out loud.** `gvn` is
  in the flavour context and `{gv}`/`{gvn}` are slots: a child asks why
  everyone stops at that stone first, and a child who has been keeping count
  says the number as if it were a secret, at thirty visits and up. The birth
  rule's `+1` is `BIRTH_OVER` in `core.js` with its reason beside it, kept
  (#82); Q17 is closed.
- [x] **Re-run everything.** The forty-day `pack()` hashes on seeds 7 and
  20260819 are byte-identical to the commit before, so at forty days nothing
  moved off its stream (#74). Green: `determinism` on both seeds, `save`,
  `leftovers`, `soak`, `strain`, `eleven` through `sixteen`, `migrate`, `saga`,
  `wider`, `decade` (the fast-path hash unchanged too) and `nan`. Two older
  checks went red on the weighted draw and both were reading their own stream
  (#66): `strain` required the first thing asked with somebody in bed to be
  heal, and `eleven` set the ground dry, ran a day and waited for rain when
  the stone asks at midnight and the ground reads .34 there on seed 7; both
  ask the stone directly now. `eleven`'s sail check rolled `wayDay`'s `.3`
  three times in sixty days and called a one-in-three miss a failure; it
  rolls the rule by hand now.

**What fought back.** The first forced ring check found nobody ever taking
the ring: `runDay` leaves the clock just past midnight, and the children were
being sent to bed before the play case ran. It sets noon first now. The forced
elder check could not loop `newDay()`, because the old-age roll takes a
sixty-five-year-old one day in four and the elder kept dying before the
five-per-cent roll landed; the telling is `tellOfDead` now, its own function,
so the harness rolls it alone. The four guard-rails live in a new `leftovers`
mode and each was broken on purpose once (#34): the independent `.9` step, the
rels-only elder, the priority list and the missing template each went red on
its own line before any went green.

*Leans on:* `js/sim.js`'s `play` case, `js/life.js`'s `tellOfDead`,
`js/watcher.js`'s `faithDay`, `js/flavor.js`'s `G`, `js/render.js`. *Save:*
none. *Model:* **Claude Opus 5** was named; *worked under Claude Fable 5.1.*

## Phase 8 — Hearth gets a machine that watches it — **SHIPPED**

**Sixteen sprints of regressions have only ever run on somebody's desk.**

`.github/workflows/` carries a CI for the School Generator and one for Numina
and nothing for Hearth. Every "harness green" claim in every handoff is a human
having run eleven commands and pasted the output. The harness is excellent,
completely unautomated, and the only test this project has.

- [x] **`hearth-ci.yml`, pathed to `Projects/hearth/**`.** In
  `school-generator-ci.yml`'s shape: `on: pull_request` and `push: main`, a
  concurrency group, `defaults.run.working-directory: Projects/hearth/test`,
  plus `schedule` and `workflow_dispatch` for the deep job (#83).
- [x] **A PR gate that finishes in minutes.** `determinism`, `save`,
  `soak --days 12 --seeds 7,20260819 --random 0` and `pinned`: 12 s, 2 s, 5 s
  and 16 s of browser time. The lockfile pins Playwright 1.56.1 exactly, and
  `playwright install` fetches its Chromium 1194, the build the recorded
  hashes were made on: V8's Math library moves between releases (the first
  run on GitHub, on 1.62.1's Chromium 1234, ran a different island from day
  one), so the pin is what makes a moved hash a claim about the simulation.
- [x] **A nightly or on-demand deep run.** All fifteen modes as a matrix, one
  job per mode with `fail-fast: false`, at 09:20 UTC daily and on
  `workflow_dispatch`. Never on a pull request.
- [x] **Determinism against a committed hash.** `test/hashes.json` carries
  the forty-day `pack()` hashes of seeds 7 and 20260819, and a new `pinned`
  mode runs each seed and compares; `--write` rewrites the file when the move
  was meant. Broken on purpose with one extra `R()` at a day boundary and
  with a one-digit edit to the file; both exited 1 naming the seed.
- [x] **Answer the board questions while here.** No board-suite entry, and
  the preview goes with the social-tag cleanup (#84).

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
