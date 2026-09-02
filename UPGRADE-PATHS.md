# Upgrade paths — September 2026

Ten projects on greyversusblue.com that would repay a major upgrade, ranked,
each with a full phase-by-phase `WISHLIST.md` in its own folder written in the
shape of `Projects/school-generator/WISHLIST.md`. This file is the index and
the argument for the order; the wishlists are the plans.

**How the ranking was made.** Every project on the board was surveyed against
its own code, its prompt file in `Claude Prompts/`, its round-3 notes, and the
two August audits. A project ranks high when three things are true at once:
there is real headroom (the next thing to build changes what the project *is*,
not how polished it looks), the foundation can bear it (a suite or harness that
would catch a regression), and the work is not already blocked on a decision
only Devon can make — or, where it is, the wishlist phases the decision as a
question with the measurements beside it.

**Which model runs what.** The user's default is **Claude Opus 5** for the
bulk of the coding. Each phase in each wishlist names its model, and **Claude
Fable 5.1** is named only where the work is a new pure model layer with subtle
invariants, a large refactor of entangled code behind a weak safety net, a
simulation or rules engine where a wrong answer is silent, a schema or save
format everything downstream inherits, or authoring that must stay coherent
across thousands of lines of existing prose. Surface work, content tables, UI
wiring, CSS, test wiring around an existing pattern, asset conversion: Opus 5.
Roughly a third of the phases below are Fable; the arc intros in each
wishlist restate the rule for that project.

**What "finished" means**, for every phase in every wishlist: the branch
became a pull request, the pull request merged to `main` with CI green, and
the closing report names the next open phase's number and its model — so
whoever opens the next session knows which one to open.

---

## The ten

| # | Project | Wishlist | First open phase (model) | The one-line case |
|---|---|---|---|---|
| 1 | Bell to Bell | `Projects/bell-to-bell/WISHLIST.md` | 1 — A day with more than two periods in it (Fable) | The most active project in the repo, with the best design doc and a vertical slice that wants to become a school day |
| 2 | Hearth | `Projects/hearth/WISHLIST.md` | 1 — Songs you can hear (Opus) | The most rigorous harness on the site, and a sim whose next pillars (a tune you can hear, decades, a wider world) are already named |
| 3 | Torchbearer | `Projects/torchbearer/WISHLIST.md` | 1 — The rules core comes out of the page (Opus) | A declared PF2e platform whose engine is still one 3,268-line script the suite cannot import |
| 4 | The Absalom Inheritance | `Projects/absalom-inheritance/WISHLIST.md` | 1 — The interrupt point (Fable) | A CRPG with a 2,000-run balance harness and no reaction, condition or template system yet |
| 5 | The Fourth Quarter | `Projects/fourth-quarter/WISHLIST.md` | 1 — The room is a description (Fable) | Pure-logic engine and campaign under Node, every venue tier the same room, 67 MB of textures |
| 6 | Faire Weekend | `Projects/Ren-Faire-Claude/WISHLIST.md` | Phase 1 | A 3,000-line suite guarding an economy that has never had a single guest walk through it |
| 7 | Daredevil | `Projects/daredevil/WISHLIST.md` | 1 — The backer-less middle game (Fable; waits on Devon — Phase 2 runs meanwhile, Opus) | Eight endings and a transcript-diff harness, with the biggest open narrative question on the site |
| 8 | Numina | `Numina/WISHLIST.md` | Phase 1 | 136,000 words of rules as prose and no data layer, so no character builder, no generated cross-links, no version diff |
| 9 | Schedule Visualizer | `Tools/schedule/WISHLIST.md` | 1 — The simulation half, in numbers (Fable) | The largest hand-written thing in the repo, two thirds of it untested, blocked three rounds on one quota question |
| 10 | Corner & Kettle | `Projects/corner-and-kettle/WISHLIST.md` | 1 — The sim without the page (Fable) | Every balance question ever asked of it was answered by hand-instrumenting a browser |

Each wishlist carries its own **Status** line, the architecture as it stands,
the conventions its own notes learned the hard way, the standing backlog, any
open **Questions for Devon**, and six to nine ranked phases with tasks,
dependencies, save-format consequences and a named model.

---

## Why each one, and why in this order

### 1 — Bell to Bell

A first-person classroom sim built on a mechanic nobody else has shipped
(*Withitness* as a vision mode that costs bandwidth and lies to you under
stress). The `CLAUDE.md` carries twelve locked design constraints, the smoke
suite has ~190 assertions, and `tests/balance.mjs` simulates whole periods
across five teaching archetypes and three seating charts — that harness is
what makes ambitious change safe. The slice is one period plus a second; the
treatment describes a semester. The wishlist's arc one builds the school day
(a real per-period save architecture first, because the two hardcoded `*5`
slots are the thing every later phase trips over), then procedural rosters,
tells and lessons validated against `balance.mjs`, then the longitudinal
meta-layer. The and-also is an asset prune: measured against `assets.json`,
932 of the 1,037 files under `Assets/` (~82 MB of 142) are referenced by
nothing — unnamed prop directories and texture variants more than the
Kenney kits' duplicate formats, and some of it a deliberate alternates
palette the prune has to keep honest. The wishlist also found that the
project loads three.js from a CDN through its import map, an offsite request
the integrity sweep cannot see because it reads resource tags, not script
bodies.

*Fable earns it for:* the save-slot architecture, the generator that must
compose valid tell schedules against the balance band, and the semester
persistence model. The content systems, the tell meshes and the prune are
Opus 5.

### 2 — Hearth

A zero-dependency living island whose whole world round-trips through the URL
hash, with a 937-line harness that soaks five islands for forty days and
demands zero violations and byte-identical `pack()` hashes across runs. The
sprint 16 handoff already names the next thing three times: songs have no
tune, and bounds-walking, heirlooms and song loss all "want a decade." The
wishlist phases the melody system (inside the existing gain budget, fire
nights only), then a generational mode with the performance work to survive a
500-day island, then the horizon island as a real destination, then scarcity
and conflict as systems the chronicle can finally have drama about, then the
chronicle as a shareable artifact, and a proper migration ladder for a save
chain now eight versions deep.

*Fable earns it for:* the generational time path, which must produce a
bit-identical world to the slow one; the migration ladder, a schema everything
after it inherits; and scarcity that must not break 22,000 soak audits. The
songs themselves run on Opus 5 — synthesis in the `note()` pattern that
already exists — as do the saga, the far island and the CI job.

### 3 — Torchbearer

The PF2e adventure engine — builder, combat, spells, items, monsters,
conditions, an effects DSL, two shipped packs, and a real fourteen-section
authoring contract. Its problem is structural: the engine is a single 3,268-line
`<script>` in `torchbearer.html`, so the Node suite's 95 checks cannot import
combat, and round 3's own notes say the combat changes "live entirely in
browser-only code the Node suite doesn't import." The wishlist's first phase
is the extraction into `js/` modules, because every other phase (reactions and
reach — `mobility` is currently *unwireable* because no monster carries
`reactive-strike`; detection and concealment; a campaign layer past the
hardcoded level 3; a pack validator) is cheaper and safer after it.

**Shared problem, stated once:** Torchbearer and The Absalom Inheritance both
need an interrupt point in a PF2e turn loop and neither has one. The
recommendation in both wishlists is to design it once here, in the declared
platform, and port the pattern; whether the two ever share *code* is bound up
with the still-open `Pathfinder/data/` ownership question, which is Devon's.

*Fable earns it for:* pulling combat out of the page (large, entangled, weak
net), the reaction/interrupt seam, and a hero who levels past 3 with the first
real `migrate`. The rules-core extraction that comes first, detection, the
action economy, the campaign spine and the validator are Opus 5.

### 4 — The Absalom Inheritance

An isometric turn-based CRPG on PF2e rules, drawn with canvas primitives and
no art assets, with the best simulation harness of any game here:
`test/balance.mjs` runs 2,000 seeded runs per build against a 45–90% win band
and has caught two bugs no playthrough would have. The notes' own backlog is
in the right order — reactions first, then a true cone template, then a third
build that exercises a `kind` the engine lacks — and reactions were deferred
only because character creation "alone touched eight files." The wishlist adds
what those imply: a duration-tracked condition engine (PF2e runs on frightened,
off-guard, slowed and persistent damage, and the rules layer has none of it),
area templates and line of effect on the isometric grid, and a pack format so
a second area stops costing six files.

*Fable earns it for:* the interrupt system, the condition engine (every check
and damage path plus a save migration) and the template geometry. Builds,
inventory and the pack loader are Opus 5.

### 5 — The Fourth Quarter

The cleanest separation of the six 3D games: `engine.js` and `campaign.js`
are pure logic with ~390 Node assertions between them, and the 3D layer sits
on top. Devon has already answered the difficulty question (spoilage, round
3), which unblocks the roadmap the README carries: distinct rooms per venue
tier (every tier is the same 30-seat room today), the full campaign port
(league standings, regulars, a rival bar, distributors, events as floor
moments), and a real fail state. The wishlist also phases the texture
pipeline — `textures/` is 67 MB of 2k Poly Haven maps with no 1k tier, and
all 27 of them load for the first room because `buildWorld()` uses every
material set — as routine work with a payoff the player feels on first load.

*Fable earns it for:* the room as a pure description with derived collision,
patrons who path to a door instead of through a table, and the league season
as a model layer with a save shape later phases inherit. Textures, the CI
job, regulars, floor moments and the fail state are Opus 5.

### 6 — Faire Weekend

Twenty-two stages, a 3,018-line JSDOM suite with seven `SIGNIFICANCE:`
balance tests, and an economy that computes attendance as an aggregate
function. "True guest-agent/pathfinding simulation remains the one fully
untouched item from Stage 9 on." That is the phase that turns a spreadsheet
into a sim, and it is the first one. Behind it: a pinch/pan/zoom canvas
grounds map with a build-preview overlay (which also retires the sub-44px tap
targets the notes have carried twice), weather off the `TIME_BLOCKS.heat` hook
that already exists, performer and vendor arcs, and a second win track.

*Fable earns it for:* the guest agents, which have to reconcile with the
existing aggregate economy without making the significance tests meaningless,
and the canvas map across `ui.js`, `main.js` and 1,060 lines of CSS. Weather,
arcs and the meta-layer are Opus 5.

### 7 — Daredevil

207 scenes, some 23,000 words of scene text, five milestones, four hubs, eight endings, and the
strongest narrative harness on the site: four committed transcript baselines
diffed line-for-line before and after any story edit. It also carries the
single biggest open item in the whole repo, in its own prompt's words: a
player who tells Earl "Not interested" is marched through the entire investor
plot anyway, because Milestones 2–4 never read the flag. The wishlist phases
that as Devon's choice with the recommendation attached (a genuine backer-less
middle game), and then builds what would have caught it earlier: relationship
state as a first-class system declared in `scenes.js`, and a branch-coverage
walker over relationship permutations that reports orphans.

*Fable earns it for:* authoring an alternate spine that stays coherent across
4,300 lines of existing prose and eight endings, and the reachability tool.
The hub economy, minigame tiers and touch pass are Opus 5.

### 8 — Numina

An Eleventy site with unusually good engineering hygiene (deterministic
committed builds, self-hosted search, zero offsite requests, a real CI job)
and ~136,000 words of rules and lore held entirely as prose. The audit's
engineering and SEO items all shipped; its accessibility section shipped
nothing and most of its content section is still open. The wishlist's arc one
is the thing that changes what the site is: a structured data layer for
skills, aspects, foundations, cultures and expressions, generated pages and
cross-links off it, and then a client-side character builder and CP
calculator — the tool a player would actually open at an event. Arc two is
the finishing work already specified: the accessibility pass (the audit wrote
the one-line fixes), the join funnel, the Excellencies stub, print packets.

*Fable earns it for:* extraction from a copyrighted rulebook under the
CONTENT-GUIDE's don't-invent and provenance rules, and the builder's
prerequisite semantics. Everything in arc two is Opus 5.

### 9 — Schedule Visualizer

~590 KB of application JavaScript across seven classic scripts sharing ~491
globals, a published-artifact mechanism that stringifies its own source, and a
simulation half — blueprint editor, pathfinding, congestion, travel-time
playback, the What-If lab — that round 3 gave sixteen assertions, every one of
them about shape and none about a number. This is the tool Devon uses at
work. The wishlist's first phase is a headless harness that drives the
blueprint editor and asserts pathfinding and congestion numerically against
the Northwind fixture; the second answers the storage-quota question that has
blocked `gvb-save.js` adoption for three rounds (as a shared-file request,
since the module belongs to prompt 22); then a real publish pipeline in CI,
the `viz-playback.js` split at the seam the README names, and — the depth
upgrade — a constraint solver that can say what breaks if you move a section.

*Fable earns it for:* designing tests against 590 KB of global-scope code, the
quota architecture, and the solver. The publish pipeline, the file split and
the accessibility pass are Opus 5.

### 10 — Corner & Kettle

A 2,542-line real-time management sim in one file with a rich barista layer
and a Devon question with the numbers already measured (patient serving:
100% accuracy, $309 net; eager serving as soon as `cupMatchesEnough()` allows:
46%, $77). Every one of those measurements was taken by hand-instrumenting a
browser. The wishlist's first phase is a seeded, clock-decoupled headless
harness in the shape of Absalom's `balance.mjs`, so the Serve gate, fumble
rates and prestige curves become numbers a test holds. Then the module split
on the Daredevil precedent, then the staff system, customers with memory, and
prestige as real meta-progression.

*Fable earns it for:* lifting the live simulation out of the DOM without
changing what it does, the balance harness itself (worth exactly its
correctness), and customers whose memory feeds spawn and reputation — a loop
with a silent wrong sign. The module split, the Serve gate, staff and prestige
are Opus 5 once the harness exists.

---

## Close behind

Not phased here, each for a stated reason. All are worth a wishlist if the
reason changes.

- **Castle Conundrum.** 165 MB of assets for 1,525 lines of code, roughly two
  thirds of the Poly Haven packs unreferenced, and a 74-line quest manager
  that is "two booleans." An asset diet plus a data-driven quest graph is a
  real path; it ranks below the ten because the notes say the piece is
  finished as designed and there is no in-project suite to build behind.
- **Orbital.** 961 lines, 22 provably-winnable levels, and a solver in its
  test suite that could become a level generator. A level editor with URL
  sharing (Hearth already proves the pattern) is the obvious upgrade. Small,
  and only one round old.
- **Pathfinder data layer.** 114 MB of committed PF2e JSON with no consumer
  contract, and a question ("is `Pathfinder/data/` a published interface?")
  raised six times. This is the highest-leverage *decision* on the site, and
  it is Devon's before it is anyone's code.
- **Closing Time.** Multi-offer escalation wars and financing as a system are
  the README's own next layers; a 97-assertion suite would hold them. Solid,
  smaller than the ten.
- **Golden Hour and Blue Hour.** Tides as a real axis for one; the causeway
  and the missing peak for the other. Both are blocked first on the same
  thing their notes name twice: nobody has run either on real GPU hardware.
- **Final Grade Checker.** Configurable grading policies and a "why this
  grade" audit trail would have surfaced the `.75`-band bug years earlier.
  Worth doing; not major.

## Cross-cutting, and not a project

Five things came up in more than one survey and belong to no single wishlist.
They are noted here so the next site-wide session (prompt 22) can pick them up.

- **CI runs almost nothing.** Three workflows exist (Numina, School
  Generator, the Firebase deploy). No workflow runs `Tools/board-check`,
  `gvb-save.test.mjs`, or any of the ~20 project suites. The School Generator
  workflow is a good template nothing else reuses.
- **Asset weight.** Bell to Bell, Castle Conundrum and The Fourth Quarter
  together carry ~380 MB: unreferenced props and texture variants, duplicate
  model formats, uncompressed glTF buffers and 2k textures with no smaller
  tier. One shared
  pipeline (prune, resize, draco/meshopt) pays off three times.
- **`gvb-save.js` v2.** Quota accounting, multi-key namespaces and an
  IndexedDB tier are what the Schedule Visualizer needs and what Hearth's and
  Bell to Bell's growing saves will want.
- **Real hardware.** The atmospheric pieces' performance numbers are all
  software rasterization (The Fourth Quarter is the exception: its round-1
  frame times were real Chrome). Touch input has "never had a thumb on it" in
  three separate notes files.
- **Ownership.** `Tools/prompt-builder.html` is owned by no prompt, swept by
  no check, and hotlinks Google Fonts. An ownership manifest that
  `check-integrity.mjs` enforces would catch the next one.
