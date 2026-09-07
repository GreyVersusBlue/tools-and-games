# The Absalom Inheritance — Feature Wishlist

**Status: Phase 6 — an area should be a file, not a diff — has shipped.** The
engine reads one tile-kind table instead of three hardcoded lists of what is
solid; `visionFeet` and `noticeFeet` are per-area overrides on a pack-global
default, and `standardDC`, which nothing had ever read, is gone; `main.js`
boots off `content/packs.json` rather than a literal URL, `?pack=<id>` opens a
second adventure off the same HTML file, and each pack has its own storage
slot; a save whose `packId` names a different adventure is refused with a
sentence a player can read. And there is a third area, **the Mason's
Undercroft**, which cost `content/vault.json` and the authoring guide and
nothing else — one legend, one grid, one placement of a creature that already
existed, one lore pillar carrying the first boon a pack has ever been able to
hand out, and two squares repointed.

**Is the new room neither free nor a wall?** `balance.mjs` at 2,000 says 4.9%
of wizard runs and 6.1% of fighter runs die in it, and it takes 16.8% and 12.1%
of all the damage the batch takes. Its optional fight pays the wizard 5.2 points
of win rate and costs her 4.5; it pays the fighter 1.4 and costs her 6.3. **The
mason's mark is a caster's boon and Kessa should walk past it** — the autopilot
never does, which is why the shipped numbers are a floor: **Wizard 79.5%**
(from 81.4%) and **Fighter 69.3%** (from 75.1%).

`test/smoke.mjs` reports **1,196 passed, 0 failed**, up from 1,067, and
`test/browser.mjs` is **39 checks in real Chromium**, up from 24. Seventeen
guard-rails in `smoke.mjs` and three in `browser.mjs` were broken on purpose
(#34), each failing at the assertion whose comment claims it — including two
that did *not* fail first time and had to be written before they would. The
Node suites run in CI, on `.github/workflows/absalom-ci.yml`; the browser one
needs playwright-core and is run by hand. Arc two has one phase left: Phase 7,
two more heirs, on Claude Opus 5.

Round one made an unwinnable vignette winnable and broke the single file into ES
modules; round two added a second area and caught a stall bug with a Monte Carlo
harness that a browser playthrough never would have; round three added character
creation and a second build, tuned across three measured passes; arc one built
the interrupt point, the conditions that expire on it, the templates that need
a line of effect, and the creatures that decide what to do with all three.

## What it is

An isometric, turn-based CRPG on Pathfinder 2e Remaster rules, played at
`/Projects/absalom_inheritance.html`. That file (412 lines) is the shell —
chrome, CSS, element ids, four modal veils — and everything that matters lives
next door in `Projects/absalom-inheritance/`. No build step, no dependencies,
nothing vendored: plain ES modules and a canvas, which does have to be *served*,
because a browser refuses ES modules over `file://`.

The whole adventure is one JSON file, and there are two of them. `content/vault.json`
carries three areas drawn as ASCII rows with a per-area legend — a 22×22 vault, a
16×12 undercroft past the Keeper's stairway, and the 14×10 reliquary beyond it —
three creature stat blocks placed five times between them, twelve commands (one of
which no build lists, because it is the Keeper's), five item types, four lore
pillars and two buildable PCs. `content/proving-ground.json` is the second pack,
deliberately tiny, and `content/packs.json` names both. The engine reads shapes,
never ids: another area's guardian is an ordinary entry in `creatures`.

What it does well is the rules. `rules.js` is real PF2e math with page
references: degrees stepping on a natural 1 or 20, basic saves scaling
none/half/full/double, MAP at −4/−8 for the agile dagger and −5/−10 otherwise,
5/10/5 diagonals carried into A*'s node key so a path's feet are exact. Every
roll goes through an injected RNG, which is what makes 2000 headless seeded
playthroughs possible in a few seconds.

What it is not: it is twelve to sixteen minutes long. Two rooms, four mandatory
fights, three lore pieces, one rest, one casket. Written before arc one started,
when there were no conditions, no reactions, no templates, no ranged attack that
could miss and no creature intelligence beyond "walk at the PC and swing." Arc
one closed four of those five. What is still true: **no ranged attack that can
miss** — every attack roll in the pack is made in reach, and the only things
that reach further are unerring or a save.

## The architecture that is there

Bottom-up. Everything from `rules.js` through `save.js` runs under plain Node
with no DOM, and that is the load-bearing habit of the project: it is why two
test suites exist at all.

- **`js/rules.js` (145)** — the PF2e math and nothing else: `degreeOfSuccess`,
  `check`, `basicSaveDamage`, `mapPenalty`, `feetBetween`, `stridesFor`,
  `parseDamage`, `makeRng`. Pure, RNG injected.
- **`js/world.js` (319)** — one area's grid. `TILE` (FLOOR, WALL, GATE, PILLAR,
  TREASURE, STAIRS), Bresenham `hasLoS`, `fieldOfView`, an eight-way `findPath`
  whose node key carries a diagonal parity bit, three creature movement planners
  (`planApproach`, `planRetreat`, `stepAway` — shared with the suite, which is
  why none of them is re-implemented in it), and the fog bitfield the save
  writes.
- **`js/content.js` (613)** — `loadPack` parses and *refuses*: a broken pack
  throws a `ContentError` with a sentence. `selectPc(content, buildId)` resolves
  a many-build pack down to the one-PC shape every other module still reads.
- **`js/ai.js` (92)** — `chooseAction(view)`: one creature's turn, decided.
  Pure the way `templates.js` is pure — a view in, a choice out, no world, no
  RNG, no state. Everything it ranks was measured by `game.js` first.
- **`js/conditions.js` (487)** — eight conditions, the modifier funnel and the
  damage funnel, the same-type rule, immunity traits, default durations and the
  turn-boundary tick. Pure and RNG-free: persistent damage hands back a spec and
  `game.js` rolls it, which is what keeps `balance.mjs` able to replay a run.
- **`js/game.js` (1,481)** — the run. Persistent `run` state, a runtime-only
  `turn` object, the reaction bus, triggers, and every command the player can
  fire. Headless: an action resolves instantly and hands back a playback script.
- **`js/save.js` (271)** — the gvb-save slot (`absalom-inheritance-save-v1`,
  schema 1) plus `makeRepair`, which resolves and clamps every field on every
  load. `migrate` exists and is empty.
- **`js/render.js` (322)** — isometric canvas from diamonds and prisms, no art
  assets, one `requestAnimationFrame` loop. **`js/ui.js` (677)** — panels, log,
  four modals, the keyboard cursor, the save bar, condition chips, and
  `pickCharacter`, built entirely from `content.pcOptions`. **`js/main.js`
  (101)** — boot: fetch the pack unresolved, load a save or run the picker,
  `selectPc` once, autosave.
- **`test/smoke.mjs` (3,200)** — 968 assertions across rules, world, content,
  game, reactions, creature policy, conditions and save. **`test/autopilot.mjs` (261)** — a competent player as code,
  generic over command *kind* rather than id. **`test/balance.mjs` (117)** — N
  seeded playthroughs per build, band-checked independently, non-zero exit if
  any build leaves the band.

Where it breaks down: **`game.js` is still the only module without a seam,**
and it is 1,359 lines now rather than 834. State, turn order, the bus,
movement, seven command kinds and the inventory all live in one closure. A turn
has interior structure and duration at last, which was the whole point of
Phases 1 and 2; splitting the closure itself is still nobody's phase.

## Conventions a new builder must know

Read these before the first edit. Every one is either in the project's own docs
or visible in the code.

- **The board URL never moves.** `/Projects/absalom_inheritance.html` is what
  bookmarks point at; do not propose moving the shell into the project folder.
- **Add a pure module and its suite together**, importable under Node with no
  DOM. `rules.js`, `world.js`, `content.js`, `game.js` and `save.js` all are,
  and that is the only reason `balance.mjs` can exist.
- **Nothing in the rules ever waits on a timer.** An action resolves fully in
  `game.js` and returns a script; `ui.js` animates that at whatever speed it
  likes. A throttled animation cannot desynchronise the game from its own state,
  and a feature that wants to pause mid-resolution must say so another way.
- **The storage key is permanent** — `absalom-inheritance-save-v1`, schema 1
  (#36) — and **`migrate` is for version drift; `repair` is for every load**
  (#37). Both of round two's save changes shipped as `repair` migrations of the
  existing shape, not a version bump.
- **A creature's storage key is its original placement, never its current
  position** — `"<areaId>:<creature>@<x>,<y>"`. That is what makes the round-two
  key migration land on the existing placement instead of duplicating it. Do not
  "fix" it to track where the creature actually stands.
- **`area` and `world` in `game.js` are `let`, read through the closure, and
  exposed as getters.** A value captured at construction goes stale the instant
  `transitionTo()` fires — it did, the first time this was wired.
- **A win, a stairway and a treasure are standing conditions, not events.**
  `checkTreasure()` and `checkStairs()` are called on every step, on a
  creature's death, from `endCombat()` and from `begin()`. `checkStairs()`
  shipped without the last two and produced a wall of full-HP "unfinished"
  results. Anything new that can be true because of where the PC stands needs
  the same treatment.
- **Measure, do not reason from the stat block.** The reliquary warden read
  41.5% at full sentinel stats; the Fighter measured 99.5%, then 93.6%, before
  landing at 79.8%. If your work touches combat math or a transition, run the
  harness.
- **A build's `commands` list is a filter, and the filter is the safety.**
  `selectPc` narrows `commands` and `commandById` to that build's ids, which is
  what stops a Fighter casting the Wizard's Shield cantrip — `commandBlocked()`
  only checks resource costs, and Shield spends none. **`pcOptions[0]` has to
  stay the Wizard**, because a save from before character creation has no
  `buildId` and `repair` falls back to it.
- **`repair` resolves before it clamps.** `buildId` and `areaId` first, because
  HP/slot/focus maxima are per-build and standable squares are per-area. A clamp
  against the wrong build or area is a PC inside masonry.
- **There is exactly one `check(` in `game.js`** and it is inside
  `roll(actor, kind, bonus, dc)` (#138). Every d20 the engine rolls goes
  through it so a condition cannot be forgotten at a call site, and `smoke.mjs`
  counts them in the file's own source. The flat check that ends persistent
  damage is the one deliberate exception, and it rolls a bare `die(20, rng)`
  because a flat check takes no modifiers.
- **A condition is a saved field; a reaction budget is not.** `conditions` on
  the PC and on every creature goes into the save additively and is absent
  entirely from a save with none; `turn.reaction` and `turn.reacted` are
  runtime-only, because a reload re-rolls initiative anyway. They are the two
  halves of the same question and they answer it differently on purpose.
- **Zero offsite requests, no build step, nothing shared across projects**
  (#17). `Pathfinder/data/` is read-only here and nothing may take a runtime
  dependency on it.
- **Assert against the DOM for anything that just happened, and against the
  save only for what a reload must survive** (locked decision #39). This
  environment's `computer{action:...}` paths have not reached the page in two
  rounds; dispatched `KeyboardEvent`/`MouseEvent` works, and `window.__absalom`
  is exposed for exactly that.
- **Break the guard-rail on purpose before you trust it** (#34). The
  invocations that actually work:

```
node Projects/absalom-inheritance/test/smoke.mjs        → 968 passed, 0 failed — SMOKE OK
node Projects/absalom-inheritance/test/balance.mjs 2000 → BALANCE OK for both builds
node Projects/absalom-inheritance/test/balance.mjs 400 --verbose   (a fast spot check)
```

## Questions for Devon

- **Is `Pathfinder/data/**` a published interface or private to prompts 01–03?**
  Asked a sixth time site-wide as of site session 10, jointly by this
  project and Torchbearer, and tracked centrally in prompt 01's own "Questions
  for Devon" block. Measured facts: 24 JSON files of PF2e rules data sit there;
  this game reads none and hand-writes three stat blocks and seven commands into
  `content/vault.json` instead. Phases 6 and 7 get cheaper if the answer is
  shared, and are unaffected if it is private.
- **Is the 53.6% / 79.8% split between builds the design, or a tuning debt?**
  Round three called the asymmetry deliberate. If the two builds are meant to be
  comparable challenges, `balance.mjs` needs a band per build rather than one
  shared 45–90% window; if they are an easy mode and a hard mode, the picker
  should say so, since a player choosing Kessa Vane cannot tell.
- **Does the adventure grow, or does the engine deepen?** Twelve to twenty
  minutes, three rooms, five fights, one of them optional. Arc one deepened the
  engine on the rooms that existed; arc two spends the same effort on more
  rooms. The order is a taste question, not a technical one.

## The standing backlog

Everything here is open and unclaimed. Add to this list rather than starting a
new one.

**The turn loop**
- Reactions exist and there are two of them. What there is not: **Delay, Ready,
  or declining a reaction.** Every reaction fires automatically, which is right
  for the two that ship (Shield Block's disc lapses at the start of your next
  turn either way, so declining only wastes it) and wrong for the first one that
  is a real choice. Torchbearer's `askReaction` is the model. **A Step is a
  creature action only** — `ai.js` chooses one and `creatureTurn` walks it
  without announcing it; the heir has no Step button, so she pays a whole Stride
  to close five feet on something that just backed off.
- **Nothing provokes, and it is a choice now rather than a consequence.**
  `world.planApproach` still cannot walk out of your reach (a path to the
  cheapest square beside you cannot cross another one on the way), and
  `planRetreat` exists to walk out of it on purpose — but the one creature that
  uses it takes the Step when the Stride would provoke. Kessa's Reactive Strike
  is correct and still fires zero times in 2,000 seeded runs. The thing that
  would change that is a creature with a reason to move that is worth a swing:
  a ranged attacker backing off to shoot, or a wounded one running.
- `turn.reaction` and `turn.reacted` are runtime fields and are not saved.
  Initiative is not saved; a mid-encounter reload re-rolls it. It now *plays*,
  which it did not before Phase 7 — `ui.resume()` starts the creature turns a
  reloaded save landed in the middle of.

**Rules and conditions**
- Conditions exist and there are eight, through two funnels (Phase 2). What
  there is not: **no dying/wounded, and no flanking, cover or concealment**. The
  grid answers two yes-or-no questions now (`hasLoS` and `hasLoE`, Phase 3) and
  neither of them is a degree, so there is still nowhere for a circumstance
  modifier from the *board* to come from — which is the half of the same-type
  rule nothing in the catalogue can currently exercise. Cover is the obvious
  next one and `traceLine` is where it would go: the walk already knows which
  squares it passed through and throws that away.
- Eight command kinds: `attack`, `self-buff`, `self-heal`, `cone`, `burst`,
  `emanation`, `unerring`, `consume`. A command can inflict a condition and end
  one, but there is still **no heal-another, no command whose whole purpose is a
  debuff, and no ranged attack that rolls to hit** — every condition in the pack
  rides a Strike or a save that was happening anyway. There is also **no `line`**,
  the fourth shape on Player Core p.387.
- Damage types are strings printed in the log; nothing reads them for
  resistance, weakness or immunity.

**Geometry and the grid**
- Three templates (Phase 3), and **no `line`** — the one shape on Player Core
  p.387 with no kind. It is the only one whose squares are not a filter over a
  box, so it is a genuinely new function rather than a fourth predicate.
- **Templates measure square centres, and the book measures corners and edges.**
  A burst's centre is a square rather than an intersection, and an emanation
  starts at the middle of your space rather than its sides. Both are knowing
  departures; both would need a second coordinate system to fix, and the day a
  creature occupies more than one square is the day that stops being optional.
  `smoke.mjs` pins the emanation/burst equality so the change announces itself.
- **Nothing dodges a template.** A caster refuses to fire one with an ally
  standing in it, and `hasLoE` cuts squares out of a shape so a pillar shadows a
  cone — but no creature *moves* to leave one, because nothing in this engine
  telegraphs a shape before it goes off. That needs an announced action a turn
  before it resolves, which is the same seam Ready wants.
- `findPath`'s open set is a `Map` scanned linearly for the lowest `f` —
  quadratic in the node count, and the first thing a larger area finds.

**Content and the pack**
- A third area cost one content file and a guide rewrite (Phase 6). What still
  costs code is a new *tile kind* — one row in `world.js`'s registry, plus a
  colour in `render.js` and a sentence in `ui.js`, neither of which the registry
  covers. Two packs, named by `content/packs.json`. What a pack still cannot
  express: an item lying on the floor, a shop, a door that is not the one gate,
  or any boon other than the three `restore` keys.
- Four builds, each with its own satchel; the picker needs no edit for a fifth
  and stacks to one column at 375px at four cards. **What a fifth build would
  cost is now the same question as what a new command kind costs**, and after
  Phase 7 the Cleric's answer was "nothing" — a statline, four command ids and
  a `startingInventory`. No shops, no levelling, no XP, no downtime —
  deliberately. **Nothing targets an ally, because there are none**: `sideOf()`
  answers `"pc"` or `"foe"` and a party is a different game (#177).
- **A `buff` still only targets the heir and a `debuff` only a creature.**
  Neither takes an area, so there is no "everything in the cone is off-guard";
  an area command's `inflicts` rider is the closest thing, and it always rolls
  damage as well. A `debuff` also cannot end a condition — `ends` is a
  `self-heal`/`consume` field and points only at the heir's own bag.

**Creatures and AI**
- Three policies (`brawler`, `skirmisher`, `caster`) in `js/ai.js`, one
  creature each. **Nothing shoots, focuses a wounded target, coordinates with
  anything else, or times an ability for a better moment**: a caster fires its
  shape on the first turn the shape catches something, which is right for a
  once-per-encounter opener and would be wrong for a second one. **Target
  selection is unwritten on purpose** — one PC, no allies, so every rule for
  choosing between targets would resolve the same way every turn (see the
  shipped Phase 4 note). Measured, and still true: over 9,100 sampled wizard
  decisions an awake construct stood at 5 feet or at 25 and beyond, and never at
  10, 15 or 20. The skirmisher is the first thing in this pack that produces a
  middle distance at all, and only for the turn it takes to close again.
- `checkDisengage()` heals a settled creature to full as anti-cheese. Nothing
  can be worn down across two engagements. Three stat blocks, five placements,
  one boss per area and one optional fight.

**Surface and accessibility**
- The hint bar follows the room, the log marks reactions and conditions, the
  heir draws in her build's own colours and the keyboard says why it refuses
  (Phase 8). What there still is not: **no sound, no settings, no difficulty
  selection**, and **no visual regression harness** — `test/browser.mjs`
  asserts DOM and counts pixels of a known colour, which is not the same as
  noticing that the board looks wrong. A golden-image pipeline is the only
  thing that would, and this project has no build step to put one in.
- **`test/browser.mjs` is not in CI**, because it needs playwright-core and a
  browser on disk. That is the same arrangement Blue Hour has, and it means the
  surface is checked when somebody remembers to check it.

**Tests and the harness**
- `balance.mjs` reports per encounter and per area, holds a baseline it
  compares exactly against, and takes a `--variant` patch (Phase 5). What it
  still cannot do: **say anything about a fight that did not happen.** Every row
  is built from encounters the autopilot walked into, so an encounter the
  goal list never reaches is not a zero, it is an absent row — and only the
  baseline's "the batch never played it" line would say so. **The autopilot is
  still one policy**, so every number is the floor of competent play; there is
  no second driver that plays badly, or cautiously, to bracket it. **`settled`
  reads 0.0% on every row**: `checkDisengage()`'s anti-cheese full heal has
  never fired under the harness, because the autopilot never breaks line of
  sight, so the one rule protecting against wear-down cheese is measured by
  nothing. And **the baseline is per build and per encounter only** — a change
  that moves damage between two commands inside the same fight passes it.
- No suite covers `render.js` or `ui.js`; both are DOM-bound and untested.
- The autopilot brawls everything and never uses the cover a player would, so
  every number it reports is a floor rather than a ceiling.

## Arc one — the turn that can be interrupted

Arc one builds for the player who has read a PF2e rulebook and keeps reaching
for verbs the game does not have — the reaction, the condition, the template.
Every phase in it was engine work on the two rooms that existed at the time
rather than new content. **Ranked by impact, and the order is the recommendation**:
reactions need an interrupt point, conditions need the durational structure that
interrupt point creates, templates need a geometry module conditions can then
target, creature AI needs all three to have anything to be smart about, and the
harness needs to see what the other four did.

Every phase names its model. **The convention here: rules-engine, geometry,
save-schema and any refactor of `game.js`'s single closure run on Claude Fable
5.1 — a wrong answer in those is silent and the suite may not catch it. Content
tables, UI wiring, test wiring around an existing pattern and surface work run
on Claude Opus 5.** A phase is *finished* only when its branch has become a pull
request, that request has merged to main with CI green, and the closing report
names the **next open phase's number and its named model**, so whoever runs the
arc next knows which session to open without reading this file.


## Phase 1 — The interrupt point — SHIPPED

**A creature walks past you with a longsword in your hand and nothing happens,
because there is no moment in this engine at which anything can say "wait."**

Every round since round one has named reactions first and deferred them, and
every time it was right: character creation alone touched eight files. The fix
is not to add Shield Block and Attack of Opportunity — it is to build the seam
and hang those two off it as proof it works. It goes first because a reaction is
the smallest thing that needs a turn to have interior structure.

Torchbearer needs the same seam and names it too — its `WISHLIST.md`, Phase 3,
builds a trigger bus for the same three reactions in a different engine.
Whichever ships first is the reference for the other: same event names, same
"one reaction per round" rule, same refusal to let a trigger fire twice.
Whether the two ever share *code* is the `Pathfinder/data/` question above,
and this phase does not wait on it.

**Shipped.** `game.js` 834 → 1,126 lines; `smoke.mjs` 308 → 425 checks.
Seventeen guard-rails were broken on purpose (#34) and every one exited 1 from
a green baseline. Three of them found nothing the first time and the tests were
written until they fired: the `still-in-reach` half of the move trigger had no
coverage at all; the sweep below tested a *copy* of the stride planner rather
than the engine's; the `reduce` effect's target check was shadowed by tests
that never damaged anything but the PC; the PC's own reaction refresh was
asserted in a scenario that never spent it, so it could not tell a working
refresh from a value nothing had touched; and the bus's refusal reason was
first a single string and then a single ctx, both of which read as passing
assertions that depended on initiative order rather than on the rule.

Torchbearer shipped this seam first, so its event names are the ones used here:
`move-out-of-reach`, `incoming-damage`, `incoming-attack`. Locked #17 keeps the
two engines from sharing a line of code, and `Projects/torchbearer/js/combat.js`
was read and re-implemented rather than imported (locked #133).

- [x] **A trigger bus in `game.js`.** `fireTrigger(event, ctx)` at three named
      points and nowhere else: before a Strike is rolled, when somebody steps
      out of a square within a reactor's reach, and when damage is resolved and
      about to land. `content.js`'s `REACTION_TRIGGERS` is the same three, and
      `smoke.mjs` reads the string literals back out of `game.js`'s own source
      and fails on the line where the two disagree — a pack naming a fourth
      event would otherwise validate and never fire.
- [x] **`turn.reaction`, one per round**, refreshed in `advance()` at the top of
      the PC's own turn and nowhere else, with `turn.reacted` (a Set of creature
      keys) doing the same job for creatures. Both are runtime-only, like
      `turn.shielded`. `reactionBlocked()` refuses with a reason string —
      `spent`, `ally`, `no-shield`, `not-in-reach`, `still-in-reach`,
      `damage-type`, `not-the-target` — the way `commandBlocked()` already does,
      and `commandBlocked()` itself answers `reaction-spent` and `no-shield` for
      a reaction command so the panel can dim the row.
- [x] **The creature turn is a generator the caller drains.** `creatureTurn(c)`
      yields steps; `runCreatureTurn(c)` collects them into the same script
      `advance()` always returned. A Stride walks square by square, so a
      reaction fires in the square it is about to leave, and a reaction that
      kills the creature stops the turn there with the stride step carrying only
      the squares it actually crossed. `ui.js` reads nothing out of the script
      and did not have to change to see any of it. The stride planner moved to
      `world.planApproach` so the suite could walk the engine's own.
- [x] **Reactive Strike, not Attack of Opportunity.** The Remaster renamed it,
      and this pack already ships Breathe Fire under its legal name. Kessa is its
      first owner at +7 / 1d8+2 with no MAP taken and none added; **the Vault
      Keeper carries it too** (locked #134), which is what makes the trigger fire
      in shipped play rather than only in the suite. **Shield Block** is Vesper's,
      on `incoming-damage`, hardness 5, physical damage only, and blocking with
      the Shield cantrip's disc destroys it. `content.js` validates `kind:
      "reaction"` against `triggers` and an `effect` of `strike` or `reduce`, and
      a creature's own `reactions` array against the pack's whole command list.
- [x] **The test that pins it,** in `smoke.mjs` §5. A reaction fires once per
      round and not twice; both halves of the move trigger, separately; a Shield
      Block reduces damage before `run.pc.hp` changes and is logged before the
      damage line; a walk interrupted mid-route stops on the square the reaction
      caught it; nobody reacts to their own side. Then `balance.mjs` at 2000
      against both builds, with a `reactions fired` line in the report.

**What the balance harness said, and it is the interesting part.** Wizard
53.6% → **64.5%**, blocking in 62% of runs — Shield Block is the first thing in
three rounds to narrow the gap between the two builds, which is half an answer
to this file's own second open question. Fighter 79.8% → **79.8%**, unchanged to
the decimal, because **Reactive Strike fires zero times in 2000 runs**: a
creature Strides to the *cheapest* open square beside the PC, and an optimal
path to the cheapest such square cannot cross another one on the way, so a
creature can enter your reach and never leave it. The Keeper's copy fires
against a *player* who walks away, which the autopilot never does. `smoke.mjs`
asserts the zero over 3,032 planned Strides so that Phase 4, the day it gives a
creature a reason to reposition, is told the rule has come alive.

*Leans on:* `game.js`'s `runCreatureTurn`/`advance`/`useCommand`,
`content.js`'s command validator, `test/autopilot.mjs`. *Save:* none beyond an
additive `stats.reactions`, repaired to 0 on a legacy save (#37) — a reaction is
spent within a turn, and `turn` is deliberately not saved. *Model:*
**Claude Fable 5.1** — a structural refactor of the one 834-line closure with no
seam, where an off-by-one in when a trigger fires is a silent rules error the
suite will happily pass. Worked under Claude Opus 5.

## Phase 2 — Conditions that expire

**`turn.shielded` is a boolean, and it is the entire status-effect system.**

PF2e is a game of conditions and this one has none, and every `check()` call
site passes a flat bonus with nowhere for a modifier to come from. Phase 1 gives
a turn interior structure; this gives it duration. Everything after it —
debuffs, smarter creatures, a Cleric — is a condition wearing a name.

- [x] **`js/conditions.js`, pure, with its suite.** A condition is
      `{ id, value, until }`; a bag of them answers three questions — what it
      does to a check, what it does to damage, what has expired. RNG-free.
- [x] **One funnel per modifier.** Every `check()` in `game.js` routes its bonus
      through `modifiersFor(actor, "attack" | "save" | "ac" | "perception")`,
      and `turn.shielded` becomes an ordinary condition. That deletion is the
      proof the funnel is real.
- [x] **Durations that tick in exactly one place** in `advance()`, in the
      actor's own turn boundaries, with an expiry writing a log line rather than
      vanishing silently. **Persistent damage** first, since it exercises the
      tick path harder than the static conditions do.
- [x] **Conditions in the save, additively.** `pc.conditions` and per-creature
      `conditions` arrays, dropped by `repair` if content no longer defines
      them, absent entirely from a save with none. A `repair` migration, not a
      version bump.
- [x] **On the sheet and in the live region.** Chips with their values, a
      marker over an afflicted creature, an announcement on gain and loss — a
      debuff a screen-reader user cannot hear is not a mechanic.
- [x] **The test that pins it.** A condition at value 2 ticking to 0 and
      expiring on the right boundary; a save round trip carrying conditions; a
      legacy save with no `conditions` key loading clean. Then `balance.mjs`.

### Increment 1 — shipped

The six boxes above are all ticked, and the row stayed for one more increment,
because what they bought is a *system with three conditions in it*, and the
phase's own sentence — "everything after it is a condition wearing a name" — is
only true once the catalogue can carry the names.

`conditions.js` is 270 lines and pure. `game.js` 1,126 → 1,359; `smoke.mjs`
425 → 599 checks. **Twenty guard-rails were broken on purpose (#34) and every
one exited 1 from a green baseline**, run against the real files rather than a
copy. Two of the twenty found nothing the first time and are worth the next
session's attention:

- The **funnel guard** is the useful one. `game.js` now contains exactly one
  `check(` call, inside `roll(actor, kind, bonus, dc)`, and `smoke.mjs` reads
  the file's own source and fails if a second appears — the same drift guard
  the three trigger names already have, because the failure mode is identical:
  a raw `check()` at a call site rolls a d20 no condition can ever move, and
  nothing about it looks wrong. The first version of that guard failed on its
  own explanatory comment, so the test strips comments before counting.
- The **boundary write** was a real bug the suite caught rather than a
  hypothetical: `boundary()` assigned the ticked bag back only when something
  had expired, so a frightened 2 decayed to a frightened 1 that was thrown
  away. The condition was there, the chip was there, the penalty was there, and
  only the number was frozen.
- The **`createGame` normalize** assertion was green with the line it guards
  deleted, twice over. First because `save.js`'s repair covers the same
  absence; then because the first turn boundary writes a bag back to every
  actor whether or not one expired, so any scenario that reaches an encounter
  has already been normalised before it can be asked. It is asserted out of
  combat now, which is the only place the line is load-bearing.

**Both content sources are measured, not asserted.** Breathe Fire sets a
critical failure alight (1d4 persistent fire, DC 15 flat check) and a critical
Basalt Fist leaves the heir frightened 1. Over 800 seeded playthroughs per
build: 142 creatures caught fire and 97 heirs were frightened as the wizard,
112 as the fighter. Win rates moved **64.5% → 65.3%** (wizard) and
**79.8% → 79.3%** (fighter), both still inside the 45–90% band, which is the
first evidence that the split between the two builds is tuning rather than
design — the same question Shield Block half-answered in Phase 1.

### Increment 2 — shipped, and the phase is closed

- [x] **A catalogue worth the funnel.** Eight conditions: `clumsy`, `enfeebled`, `stupefied`,
      `off-guard` and `slowed` joined the three. The same-type rule is tested against a second
      status penalty from a *different* condition at last, which is frightened plus clumsy.
- [x] **Damage is funnelled.** `damageFrom(actor, spec, source)` is the only `rollDamage(` in
      `game.js`, guarded the way the one `check(` is.
- [x] **A condition that costs an action.** `slowed`, read in `advance()` and in `creatureTurn`.
- [x] **Ending one on purpose.** The Reliquary Warden's Cinder Fist sets the heir alight; Rousing
      Splash rolls Player Core p.409's DC 10 to put it out.
- [x] **Immunities.** `immunities` on a creature, traits on a condition, refused out loud.

The one thing this increment found that the plan had not is that `modifiersFor`'s four kinds were
three separate approximations rather than one:

- **Nine modifier kinds, not four.** `attack` split into `attack-str` and `attack-dex` because
  enfeebled is a Strength penalty and clumsy a Dexterity one, and one kind makes Vesper's finesse
  dagger and Kessa's longsword the same weapon. `save` split into `save-fort`/`save-ref`/
  `save-will` because clumsy is Reflex and stupefied is Will, and one kind makes both of them
  frightened with another name. `spell-dc` is new because a stupefied caster's DC moves and
  nothing was reading it. A command names the ability that swings it; `str` is the default, so no
  existing pack had to change.
- **`source` on the damage funnel is not optional** — `weapon`, `spell`, `persistent` or
  `healing` — because three of the four take no modifier at all, and a caller allowed to omit it
  is a caller guessing.
- **The `slowed` ordering is the whole of it.** Both action counts are read *after* that actor's
  start boundary. Slowed is `self-end` because a slowed that expired at the start of your turn
  would come off before the turn had any actions to take away; off-guard is `self-start` for the
  mirror-image reason. A break that swapped them is one of the thirty-five.
- **`autopilot.mjs` had no `self-heal` branch at all**, so Rousing Splash had never been cast in a
  single one of the balance numbers this project has ever quoted. `combatPolicy` reads `ends`
  rather than the command id, the way the rest of it reads `kind`.
- **A condition applied by content gets its duration from the catalogue, not the pack**
  (`defaultUntil`). A pack that had to remember to write one would ship one that forgot, and a
  forgotten duration is a −2 stapled to the heir for the rest of the delve.

**Six content sources, one per new condition, all measured over 2,000 seeded runs per build.** A
critical dagger leaves a construct clumsy (1,059 times), a critical longsword leaves it enfeebled
(1,026), Force Fang slows whatever it hits (3,545), a critical sentinel fist leaves the heir
off-guard (533 as Vesper, 398 as Kessa), a critical Basalt Fist leaves her frightened *and*
stupefied (239 and 239 as Vesper, 272 and 272 as Kessa), and the Warden's Cinder Fist sets her
alight (193 and 72). Stupefied cost Vesper **39 spells** to its flat check and Kessa nothing,
because she casts none. Rousing Splash was cast on a burning heir **238 times and put the fire out
129** of them. Nothing frightens a construct yet, exactly as the plan said, so the suite is what
exercises immunity.

**Slowed's source found a bug rather than needing one.** `inflicts` on an unerring command
validated at load and then did nothing at all — the unerring branch never called `applyInflict`,
because it rolls no attack and so has no degree to read. It passes `DEG.SUCC` now: an unerring
effect lands, and `on: "hit"` is what that means. Force Fang is the only source of slowed in the
pack, and Vesper has one focus point plus whatever the gate's rest gives back, so it fires about
twice a run.

**Win rates moved 65.3% → 60.8% (wizard) and 79.3% → 80.8% (fighter)**, both at 2,000 runs and
both measured against a clean checkout of the previous commit in the same container. Both are
inside the 45–90% band. The split widened rather than closed, and this time the reason is legible
rather than a shrug: the same critical fist costs a caster a spell and a fighter nothing.

**`smoke.mjs` goes from 599 checks to 787, and thirty-seven guard-rails were broken on purpose**
(#34) against the real project files, every one exiting 1 from a green baseline and every one
checked against the assertion whose comment claims it rather than merely against a non-zero exit.
**Four found nothing useful the first time.** Three are the same failure the last increment
logged, an assertion that could not see the thing its comment claimed, and they are now locked
decision #147:

- **The splash test counted a refused command as "the fire held."** One seed out of forty refused
  the cantrip, and that single refusal was the whole of its evidence that the DC 10 check ever
  fails: deleting the check left the suite green. It skips refusals now and wants at least three
  of each outcome.
- **The stupefied test never checked the DC.** It asserted at stupefied 19 that the cast fizzled,
  which stayed true when the base DC was broken from 5 to 0, because DC 19 is also unbeatable. It
  reads the logged `vs DC 6` and `vs DC 8` now, which is the formula rather than a number that
  happens to be hard.
- **The disc's bonus *type* is not observable, and the test's comment said it was.** Player Core
  p.443 bites when a type holds two bonuses or two penalties; one of each sums identically whether
  they share a type or not. Changing the Shield cantrip to an item bonus left the suite green. The
  same-type rule is really pinned by frightened-plus-clumsy, two status penalties from two
  different conditions, and the assertion says so now instead of claiming the off-guard pair
  proves it. The note in `vault.json` claimed it too, and no longer does.

The fourth is smaller and worth writing down anyway: **the off-guard duration assertion crashed
instead of failing.** Breaking `applyInflict`'s `defaultUntil` lookup left `until` null, and
`.until.when` threw a TypeError, so the run exited 1 with no `FAIL` line at all — a non-zero exit
that says nothing about which guard caught it, which is the failure mode #34's "read the failure
message" clause is about. It reads `until?.when` now and fails with the sentence it was written
with.

*Leans on:* `rules.js`, `game.js`'s check sites, `save.js`'s `repair`,
`ui.js`'s `refresh`. *Save:* additive per-actor `conditions`, repaired against
content, no version bump. *Model:* **Claude Fable 5.1** — a new pure model layer
with subtle invariants that every check and damage path inherits, plus a save
shape that is permanent once written.

## Phase 3 — Templates, and line of effect — SHIPPED

**The cone was a 90-degree wedge with a comment apologising for it, and
`render.js` drew a different one from its own copy of the math.**

The README flagged the approximation honestly, which beats pretending. The
duplicate in `render.js` was the bug in waiting: it re-implemented the bearing
test inline and hardcoded `feet > 15`. Breathe Fire is 15 feet, so preview and
resolution agreed by coincidence.

- [x] **`js/templates.js`, pure, with its suite.** `coneSquares(origin, target,
      feet)`, `burstSquares` and `emanationSquares`. Grid squares in, grid
      squares out; no world, no content, no state, no terrain. The cone is the
      quarter circle Player Core p.387 names, snapped to one of eight grid
      directions at the 22.5° octant boundary and cut to range by `feetBetween`
      — 11 squares at 15 feet orthogonally, 34 at 30, 116 at 60, and one more
      than each of those on the diagonal, because 5/10/5 makes the grid
      anisotropic and a shape that came out even both ways would have stopped
      measuring in feet.
- [x] **One caller each.** `game.templateSquares(cmd, target)` is the only
      caller of any of the three, and `game.js`'s area branch and `render.js`'s
      aim preview both read it. Both inline copies of the trigonometry are
      gone, the hardcoded 15 with them, and `smoke.mjs` fails on a `Math.atan2`
      in either file — the same drift guard the two funnels have.
- [x] **Line of effect, distinct from line of sight.** `blocksSight(x, y)` takes
      no gate argument at all now; `blocksEffect(x, y, gateOpen)` is the one
      that stops at a shut gate, and `hasLoE` is what every template and every
      `unerring` command filters through. `world.reachableFrom` is the only
      place a shape meets terrain. `burst` and `emanation` are validated kinds
      with one command each — Ember Burst and Warding Pulse — and an area
      command that is not a spell throws at load, because the spell DC is the
      only save DC the engine has.
- [x] **The test that pins it.** 879 assertions, up from 787. The cone's square
      set is written out square by square at 15 feet and counted by hand at 30
      and 60; the preview set and the resolution set are the same call, so the
      assertion is that exactly the creatures standing in the previewed squares
      rolled a save. Sixteen guard-rails were broken on purpose from a green
      baseline and fifteen failed at the assertion whose comment claims them.
      The sixteenth crashed instead of failing and was rewritten — same defect
      as last phase's `until.when`, and worth writing down twice.

**What the measurement found, which the plan did not predict.** The two new
commands validated at load, appeared in the command list, and were cast zero
times: the wizard's win rate came back bit-identical to the build before them,
to every decimal. That is the third time in two phases this project has shipped
content nothing reaches. `balance.mjs` counts casts per command now and exits
non-zero when one reads zero (#151). Fixing it took a policy that weighs the
burst against the cone rather than checking them in a fixed order, and a
measured answer to what an emanation is *for* in an adventure whose fights are
all duels: sampling 9,100 wizard decisions, an awake construct stood at 5 feet
or at 25 and beyond, and never once at 10, 15 or 20.

**And getting them to fire displaced Shield, which took Shield Block with it**
— 4,143 casts and 0.71 reactions a run became 0 and 0.00, caught by the same
guard on the same run. The fix is a policy that was too narrow before either
spell existed: the last action of a melee turn went to the disc only at a
multiple attack penalty of 8 or worse, and a level-1 wizard with a construct in
reach wants the disc up every round whatever her MAP is.

Win rates over 2,000 seeded runs per build, with the two causes separated:
**60.8%** before the phase, **73.8%** from the widened disc rule alone on the
old kit, **82.8%** shipped. The fighter is **80.8%** at every row, which is the
split the plan predicted; 13 of the wizard's 22 points are the harness having
played her badly rather than anything this phase built. Warding Pulse costs one
action because a three-action turn holds Strike, ring and disc and a two-action
ring does not, and it rolls a flat 1d4 because 1d4+2 measures 86.7% against a
band ceiling of 90%.

**The two builds are within a point of each other for the first time, and it is
the ceiling that is close now rather than the floor.** That is the next Absalom
row's first problem, not this one's.

*Leans on:* `world.js`, `game.js`'s `useCommand`, `render.js`'s aim preview,
`content.js`'s validator. *Save:* none. *Model:* **Claude Fable 5.1** — grid
geometry where a wrong square is silent, and the one place a preview and a
resolution can disagree without anything erroring.

## Phase 4 — Creatures that know what they are standing in — SHIPPED

**Every creature in this game played the same one-line strategy: walk at the
player and swing.**

`runCreatureTurn()` was twenty lines and its whole policy was "if adjacent,
Strike; else Stride toward the nearest open square beside the PC." Correct while
a creature had nothing else to do. After phases 1 through 3 it had three things
to do instead, and this is the phase that gives them to it.

- [x] **The policy is out of the loop, and it is its own pure module.**
      `js/ai.js` (92 lines) is `chooseAction(view)`: a view in, a choice out,
      with no world, no RNG, no state and nothing it can mutate. `game.js`'s
      `situation()` measures once — reach, the approach leg, the retreat leg,
      the Step square, every ability resolved against the board — and hands the
      pure half over; `creatureTurn()` executes the option that was scored,
      never a second one planned on the way out. The refactor alone was checked
      by measuring: 400 seeded runs came back **80.5% and 81.8%, bit-identical
      to the build before it**, which is the shape of a lift that lifted nothing
      else with it.
- [x] **A per-creature `ai` field in the pack.** `"brawler"` is the default and
      is the old strategy exactly, so a pack written before this phase keeps its
      behaviour without an edit. `"skirmisher"` and `"caster"` are the other
      two. `content.js` refuses an unknown one, and refuses a caster with
      nothing to cast.
- [x] **Reaction awareness, and it reads the bus rather than the build.**
      `provokedBy()` builds the bus's own ctx and asks `reactionBlocked()`, for
      every square of the walk it is considering. So the warden Strides 20 feet
      away from Vesper and Steps 5 feet away from Kessa, off one measurement
      rather than a build check — a Step is the five feet that triggers nothing
      (Player Core p.418), and the whole reason to take one.
- [x] **The Vault Keeper has a real kit.** It already had Reactive Strike; it
      has **Gravel Wave** now — 2 actions, a 15-foot cone, 2d6 bludgeoning,
      basic Reflex against **its own DC 16**, off-guard on a critical failure,
      once per encounter. No build lists it, so no heir can cast it; a creature
      reads its abilities out of the pack's whole command list the same way it
      reads its reactions.
- [x] **The test that pins it.** The skirmisher demonstrably Steps rather than
      trading, in a seeded encounter, and the assertion is that the reaction
      *did not fire* — a creature that dodged the swing and a creature that was
      never offered one look identical from a win rate. The Keeper's kit fires
      in 87% of runs that reach it. `smoke.mjs` goes from **879 assertions to
      968**, and `balance.mjs` fails on a creature ability nothing ever used.

**Target selection is deliberately not in this phase.** The plan asked for
"whether it prefers the wounded, the caster or whoever hit it last" as a content
field. This adventure has one PC and no allies, so every one of those fields
would resolve to the same target on every turn of every fight: a validated,
documented, exercised-by-nothing content field, which is the failure #151 was
written to catch, dressed as a feature. It belongs to the phase that adds a
second target. Recorded rather than skipped.

**Where the balance actually moved, measured at 2,000 seeded runs per build with
the two causes separated:**

| | wizard | fighter |
| --- | --- | --- |
| before this phase | 82.8% | 80.8% |
| the skirmisher alone | 82.8% | 81.2% |
| the Keeper's cone alone | 81.2% | 74.7% |
| shipped | **81.4%** | **75.1%** |

**Hit and run measured neutral, and shipped anyway.** The warden that backs off
costs itself an action to cost her one, and over 2,000 runs those cancel to
within a tenth of a point for the wizard and four tenths the other way for the
fighter. What it does change is how long the fight runs: the median wizard
encounter goes from 14.3 rounds to 15.2. The temptation on a neutral number is
to keep tuning until it shows one; the honest report is that a Step is worth
about what a Step costs (#161).

**All of the movement is the cone, and it lands on Kessa twice as hard.** She
has no disc: Vesper's Shield Block soaks 5 of a 2d6 wave and her AC and Reflex
are each a point better. That is the widest the two builds have been apart since
character creation shipped, and it is the ceiling problem the last phase left
behind, answered from the other end — nothing was taken away from the wizard.

**Kessa's Reactive Strike still fires zero times in 2,000 runs, and now it is
for a reason.** Before this phase nothing ever left her reach because
`planApproach` cannot walk out of it. Now something can, and chooses not to:
the skirmisher takes the Step. The suite's sweep still asserts that no planned
*approach* leaves her reach, and its message says the newer thing.

**Nine guard-rails were broken on purpose** (#34), every one exiting 1 from a
green baseline at the assertion whose comment claims it: `provokedBy` forced to
false (the warden Strides, Kessa's Reactive Strike kills it, four assertions
fail), `templateSquares` ignoring its caster (the cone comes out of the heir and
catches nobody), the once-per-encounter budget removed, a Step that calls
`announceStep`, the caster's ally check dropped, the "does not close again"
rule dropped, Step and Stride swapped in priority, the ability sort inverted,
and the Keeper demoted to a brawler in the pack (`balance.mjs` prints
`CONTENT NEVER REACHED — Gravel Wave` and exits 1). **One of them found a
guard-rail that could not fail**: `planRetreat`'s "do not end inside her reach"
test is invisible at reach 5, because one square directly away from an adjacent
square is already 10 feet off. The sweep runs at reach 5 and reach 10 now, and
the deleted line fails 131 of 6,051 retreats at 10 (#163, and #147 again).

*Leans on:* phases 1–3, `game.js`'s `runCreatureTurn`, `content.js`'s creature
validator, `test/balance.mjs`. *Save:* none — `ai` is a content field, and an
ability's once-per-encounter spend is runtime-only for the reason the reaction
budget is (#160). *Model:* **Claude Opus 5.**

## Phase 5 — A harness that says which fight killed you — SHIPPED

**`balance.mjs` reported one number per build, and one number could not tell
you whether the Keeper was too hard or the sanctum was free.**

It can now, and the answer is that **the Vault Keeper is where this adventure
is decided.** It kills 13.1% of every wizard run and 20.9% of every fighter
run — 70% and 84% of all defeats — in a fight that happens 0.97 times a run.
**The sanctum, which two whole phases were spent on, kills 3.0% of Vesper's
runs and 0.4% of Kessa's**, and accounts for 19.5% of the damage Vesper takes
against 3.2% of Kessa's. The Reliquary Warden is very nearly free for the
fighter, and no aggregate this project has ever printed said so.

- [x] **Per-encounter reporting.** One row per encounter, keyed by the area and
      the creature that started it, off the engine's own `mode`, `woke`, `area`
      and `end` events rather than anything the loop watches from outside — a
      fight that ends because every construct settled back into stone never
      passes through the autopilot's combat branch at all. Each row carries how
      often it happens, how long it lasts, what it deals and takes, and how it
      ends. Two sentinels wake separately, so "the sentinel fight" is a row that
      happens 2.00 times a run.
- [x] **Per-area reporting**, plus the **build × area matrix** as one table at
      the end, so a fourth build costs three lines rather than a fourth report.
- [x] **A stored baseline** in `test/baseline.json`, written by
      `--write-baseline` and compared every run. **The comparison is exact, not
      statistical**: every run is seeded `0x5EED + i`, so the same code over the
      same run count gives the same numbers to the decimal, and the check only
      runs when the run count matches the baseline's (2000, which is what CI
      uses). `DRIFT` is 3 points of win rate, 3 points of an encounter's deaths,
      and 15% of an encounter's damage taken.
- [x] **Reaction and condition counters, by actor and by name.** Vesper's
      Shield Block fires 2.31 times a run in 88.3% of runs; Kessa's Reactive
      Strike still fires zero times in 2,000, which is now a line in the report
      rather than a thing a handoff has to remember to say.
- [x] **`--variant name={json}`**, repeatable, an RFC 7386 merge patch loaded
      through the same `loadPack` a real pack goes through, printing the columns
      side by side — win rate and where the deaths went. Phase 4's four-row
      causal table was thirty lines of throwaway script; it is two flags now.
      A patch that leaves a caster with nothing to cast is refused there exactly
      as a bad edit to `vault.json` would be.
- [x] **The test that pins it.** The Keeper's fist went from 1d6+2 to 1d6+4 on
      purpose. The band did not notice — 69.5% and 64.7% are both comfortably
      inside 45–90% — and the baseline exited 1 naming the fight: *"fighter,
      vault/vault-keeper: killed 20.9% of runs, now 31.3%."* Nine more
      guard-rails in `smoke.mjs` were broken one at a time from a green
      baseline, each failing at the assertion whose comment claims it.

**Two numbers per encounter, because one was not enough, and the harness found
that out about itself on its first real break.** Damage taken per fight
truncates: a fight that kills you stops dealing damage. The 1d6+4 Keeper cost
Kessa 10.4 points of win rate and moved her damage-taken in that fight by 1.8,
against a tolerance of 1.9 — silence. Deaths per encounter moved 10.3 points
and did not truncate. Both are checked now; the second is the one with teeth.

**One break left the suite green, and the comment was the thing that was
wrong** (#147). The watcher reads the creature that started a fight off the
last `woke` event; swapping it to read `game.awake()[0]` instead left all
assertions passing, because combat opens on the *first* wake and at that
instant exactly one creature is standing. The two readings cannot differ on a
fresh run. The case that does distinguish them is the one with no wake at all —
a save restored mid-encounter, where `begin()` rolls initiative itself — so the
test is that one now, and deleting the fallback reports the fight as
"unknown".

**`settled` reads 0.0% on every row of every build**, which is the report
telling on the engine: `checkDisengage()`'s full-HP anti-cheese heal has never
fired under the harness, because the autopilot never breaks line of sight. It
is wired, validated, and exercised by nothing — the same shape as the three
casualties on record, found in one line of a table rather than in a phase.

**Nothing about the game moved.** 81.4% and 75.1%, the same figures to the
decimal as the build before this, which is what a phase that only measures is
supposed to look like. `smoke.mjs` goes from 968 assertions to 1,038. The one
engine edit is `endCombat()`'s `mode` event, which now carries the `why` it
already had: "the floor is clear" and "everything hunting you settled back into
stone" are different endings and there was nothing left to read them off once
the mode had changed.

## Arc two — more adventure than engine

Arc one deepened two rooms. Arc two makes rooms cheap. It builds for the person
who wants to *write* an adventure for this engine rather than extend it. Phase 6
has shipped and the claim it was written to test held: a third area cost
`content/vault.json` and the authoring guide, and nothing in `js/`. Guide §12 is
the worked example and is honest about the one thing the phase's own bullets did
not cover — a pack had no way to hand out a reward, which is why `restore` moved
from a gate-only field to a shape a `lore` entry carries too. Same terms as arc
one — **ranked by impact, the order is the recommendation**, same model
convention, same definition of finished. One phase left.

## Phase 6 — An area should be a file, not a diff — SHIPPED

**Adding the sanctum touched `content.js`, `game.js`, `save.js`, `render.js`,
`ui.js` and `vault.json`, and the guide said a third area cost the same six.**

It cost none of them. The Mason's Undercroft is a diff to `content/vault.json`
and `content-authoring-guide.md`: one legend, one grid, one `tuning` block, one
placement of `shattered-sentinel`, one `lore` entry, and two squares repointed
so the vault's stairway lands in it and its own leads on to the reliquary.

- [x] **A tile-kind registry.** `TILE_KINDS` at the top of `world.js` is the
      one table. `world.js`'s three barrier predicates read it, `content.js`'s
      legend parser reads it, and `save.js`'s `standable` — which had a third
      copy of "wall or pillar, and the gate until it is open" written out
      longhand — reads it. All three answers default to `true`: a kind that
      declares nothing is solid, and you opt out of solidity, never into it.
      `tileBlocks` throws on a barrier name it does not know, because the
      alternative is reading `undefined`, which is falsy, which is "nothing
      blocks".
- [x] **Per-area `tuning` overrides.** `areas.<id>.tuning` layers on the
      pack's, key by key; `game.js` reads `area.tuning` and never
      `content.tuning`. The undercroft is at 20 ft of both and it is
      load-bearing rather than atmosphere — see the optional encounter below.
      An unknown key is refused with the legal ones in the message, and
      `standardDC` is gone (#173): it had never been read by anything, the
      guide's own warning said so and kept it anyway, and per-area overrides
      would have turned one dead key into one per area.
- [x] **More than one pack.** `content/packs.json` is the manifest and
      `?pack=<id>` picks one; an unknown id falls back to the default, because
      a query string is a thing a player can mistype. A pack's `file` must be a
      bare filename beside the manifest, and a file whose own `pack.id`
      disagrees with the manifest's name for it is refused at fetch (#174).
      `content/proving-ground.json` is the second pack: one room, one build,
      one straw golem, played end to end by the same autopilot in `smoke.mjs`,
      and broken there in three ways the shipping pack never would be.
- [x] **`packId` with teeth.** A save naming a different adventure is refused,
      and `slot.refusedBecause` carries the sentence — `main.js` puts it in the
      save bar, and it replaces gvb-save's generic "that is not a valid save"
      on an import. Each pack also gets its own storage key: the vault keeps
      the bare one it has always written to (#36 is about what is on somebody's
      disk), everything else gets `absalom-inheritance-save-v1:<packId>`, so
      opening the proving ground cannot overwrite a vault run in progress.
- [x] **A third area as the proof.** The undercroft, between the vault and the
      reliquary. Its one fight is genuinely optional: the route from the
      arrival square to the stairway out never comes within the room's own
      `noticeFeet` of the sentinel with a line of sight to it, and stepping
      into the west doorway does. `smoke.mjs` asserts that square by square.
      The reward is the mason's mark, a `lore` entry carrying
      `restore: ["hp","slots","focus"]` and `restoreHp: 8` — the same three
      keys the gate's seal-release has always had, which is the whole
      mechanism a pack now has for rewarding an optional fight and
      deliberately not a new tile kind (#175).
- [x] **The test that pins it.** Both packs loaded in `smoke.mjs`, the new area
      played end to end through `playThrough()`, a cross-pack save refused
      rather than silently repaired, and `balance.mjs` at 2,000 with the
      per-area report: **4.9% of wizard runs and 6.1% of fighter runs die in
      the undercroft, and it takes 16.8% and 12.1% of all damage taken.**
      Neither free nor a wall.

**What the third area taught that the second could not.** A stairway you land
on is a stairway you immediately take again, so the undercroft's arrival square
is plain floor — the vault→sanctum pair never showed this, because the sanctum
has no stairway. And a room in the middle moves the dice under every room after
it: the undercroft's fight shifted the warden fight downstream, the heir ended
it standing somewhere else, and "read the reliquary plaque" fell from 64% of
runs to 5.3% — because the plaque sat directly behind the casket from the
landing, so the walk to read it crossed the casket lid and won the run first.
It had always been that fragile. The plaque moved west and reads 74.6% now.
`balance.mjs` reports a share per non-gating pillar rather than "read three
pillars", which was a stand-in that held only while the plaque was the third.

## Phase 7 — Two more heirs, with their own satchels — SHIPPED

**A third build costs far less than the picker did, and the row asked for the
two that exercise a command kind the engine lacks rather than another striker.**
It got one of the two it named, and the reason is worth writing down.

**`heal-other` cannot be built here, and no amount of care would have made it
work** (#177). This engine has exactly two sides — `sideOf()` answers `"pc"` or
`"foe"` and nothing else — so the only creature a `heal-other` could target is
something trying to kill you. A Cleric who heals an ally needs an ally, and an
ally is a party, and a party is a different game. What the row was actually
pointing at is a command whose effect is a condition rather than a number, and
this engine can reach that from both sides: **`buff`** puts one on the heir and
**`debuff`** puts one on a creature. Those are the two that shipped.

- [x] **`buff` and `debuff` command kinds**, validated in `content.js` and
      resolved in `useCommand`. `buff` replaces `self-buff` rather than sitting
      beside it (#178): the old branch wrote `applyCondition("pc", "shielded",
      cmd.acBonus || 1, { who: "pc", when: "start" })` — the condition id, the
      value's default and the whole duration hardcoded in the engine for a
      thing that is content. Shield now writes `applies: { condition:
      "shielded", value: 1 }` and the duration comes off the catalogue, which
      grew `defaultUntil: "self-start"` on the disc to hold it. `debuff` is the
      first command in this engine whose entire effect is the condition: one
      target, one save, no damage, and content.js refuses one that carries a
      `damage` field, one that applies something the catalogue calls helpful,
      and one that writes neither `spell` nor a `dc` of its own.
- [x] **`inflicts` gained `on: "fail"`** (#179) — failure *or worse*, the
      mirror of what `hit` means from the other side. Without it a debuff could
      only fire on a critical failure, which is a build built on a one-in-five.
- [x] **Precision damage as a rider on `attack`** (#180):
      `precision: { damage: "1d6", when: "off-guard" }`. `when` names a
      condition rather than meaning off-guard by definition, so a pack that
      wants a blade that bites the frightened needs no code change. It is
      doubled by a critical hit and rolled under its own `damageFrom` source,
      because enfeebled is a penalty to *the* melee damage roll once and the
      weapon line beside it has already taken it.
- [x] **Two builds in `pcOptions`, tuned across measured passes.** **Mother
      Isbeth Sarr** (Warpriest Cleric 1, 18 HP, AC 16, Will +7) carries three
      rank-1 slots that are all one spell, the Warding Litany, and a mace. She
      cost **no engine change at all** — a statline, four command ids and a
      satchel. **Nim Corvale** (Rogue 1, 15 HP, AC 16, Reflex +7) is the whole
      case for the two new kinds: Shim, Strike, Strike, with both swings into
      −2 AC and a second d6. Two passes, not three: the first put Isbeth at
      50.0% with the Keeper killing 36.7% of her runs, and one statline pass
      (Warpriest rather than cloistered — AC 16, STR 3, 18 HP) put her at 74.4%.
- [x] **`startingInventory` moved to per-build with a pack-level default**
      (#181), resolved in `selectPc` **and again in `save.js`'s `freshRun`**,
      because `main.js` picks a build, calls `freshRun` with the *unresolved*
      pack, and only then runs `selectPc` on what comes back. The unit test
      that only knew about the first one was green for an afternoon while every
      build in the browser opened its bag on the same longsword and spellbook;
      `test/browser.mjs` is what said so.
- [x] **The autopilot learned the new kinds, with no branch naming a build.**
      Emergency healing is now "whichever of this build's `consume` and
      `self-heal` commands puts the most back" rather than the literal id
      `"potion"`; the buff branch asks whether *this build's* buff condition is
      already standing rather than `game.shielded`, which is the disc's own id
      and answers false forever for a Cleric; and a debuff goes in before the
      swings that profit from it, read off `inflicts` rather than off the id.
- [x] **The test that pins it.** A 40-seed `playThrough()` per new build, each
      asserting its own new kind actually fires; `balance.mjs` at 2,000 across
      all four with `test/baseline.json` rewritten; and twelve guard-rails
      broken on purpose, each failing at the assertion whose comment claims it.

**Two things the browser suite caught that 1,370 Node assertions could not.**
The satchel resolved on the wrong side of `selectPc`, above. And a run reloaded
on a creature's turn sat **frozen** — `pumpEnemies` is started by an action's
`resolve()` and by a walk, and a boot is neither, so a tab closed while a
sentinel was mid-turn came back to a board that would not move until the player
pressed a key it then refused. `ui.resume()`, called from `main.js` after
`begin()`, is one line and the bug was three rounds old.

**One guard-rail did not fail first time, and the fix was the right one** (#147).
Breaking `buffWorthCasting` back to `game.shielded` left the litany's *cast
count* higher, not zero — the policy re-cast a ward that was already up, every
turn — so a test that counted casts could never see it. The assertion that
catches it drives the policy to its last action with the ward standing and
checks it swings instead.

**What the four builds measure**, 2,000 seeded runs each, band 45–90%: **Vesper
79.1%, Isbeth 74.4%, Kessa 69.3%, Nim 68.0%.** Kessa's number did not move at
all, which is the check that the autopilot generalisation changed nothing for a
build with one healer and no buff; Vesper's moved 0.35 points, from a wizard out
of potions now reaching for Rousing Splash.

## Phase 8 — The debts on the surface — SHIPPED

**A stairway swapped the whole board out and the hint bar still described the
room you left.**

Small, real, and each carried forward at least one round because no session was
already in the file. Batched so one session paid the cost of opening `ui.js`
and `render.js` once.

- [x] **The hint bar on transition.** `transitionTo()` calls `setHint()` now,
      before it emits `area` and before `checkTreasure()` — that order matters,
      because standing on a guarded casket is a more specific thing to say than
      "you are in the reliquary" and has to be able to win. The line is content:
      an area carries a `hint`, and `content.js` **requires one on any area a
      stairway leads into**, checked against the stairways rather than against
      every area. So there is no fallback branch: an area you can arrive in
      always has one, and the vault — which nothing points at — deliberately has
      none, because `intro.hint` is the line for the room you have not left yet.
- [x] **A loaded save comes back with a hint bar**, which it did not: nothing
      set one, and the only thing that ever would was the first turn of an
      encounter. The area's own hint, falling back to `intro.hint` for the start
      area, which is the one place both halves of that rule are reachable.
- [x] **The PC looks like the build.** `palette` is a required field on every
      `pcOptions` entry — three `#rrggbb` faces, validated, no default. A
      default is how two builds come to look identical, and that is exactly what
      had happened: `render.js` owned `pcTop/pcLeft/pcRight` where no pack could
      reach them and the wizard and the fighter drew the same blue prism for two
      whole rounds. Kessa is steel green, chosen against the board rather than
      for her: the foes are red and the Keeper purple, so a warm PC reads as one
      of them at a glance. The picker draws the same three faces as a swatch on
      the card, off the same field, so the card and the board cannot disagree.
- [x] **Reactions and conditions styled in the log.** They were plain `info`
      lines in a column where the dice rolls were the only thing with a colour,
      which made a Shield Block read as narration. Two log kinds of their own,
      and `ui.js` maps kind to class off a **table rather than a chain of
      ternaries** — the chain had an `else` that turned everything unknown into
      a dice roll, so both new kinds would have arrived wearing the dice
      column's colour without a line of `ui.js` changing. The condition stripe
      is the same colour as the marker `render.js` draws over an afflicted
      creature's head.
- [x] **A keyboard pass over every verb the arc added.** Every kind already had
      a path — number keys arm, arrows aim, Enter fires, an emanation goes off
      on the key because there is nothing to aim — and the gap was the refusal.
      A pointer sees a greyed button and a cost glyph; a keyboard got silence,
      the same key doing nothing for six different reasons. `refusal()` turns
      `commandBlocked()`'s one-word reason into a sentence, exhaustively, and
      falls through to the reason itself rather than to silence. A reaction's
      number says a reaction has no number.
- [x] **The test that pins it.** `test/browser.mjs`, 24 checks in real
      Chromium against the served page: the swatches against the pack's own
      colours, the fighter's top face counted on the canvas *and the wizard's
      counted at zero*, the refusal sentences off `#live`, the hint bar across a
      real keyboard walk onto the stairway, and the log's classes and computed
      border colours. Seven of them were broken on purpose (#34) and each failed
      at the assertion whose comment claims it. On the Node side `smoke.mjs`
      goes 1,038 → 1,067 and five more were broken the same way.

**The autosave is why the first version of the browser suite could not seed a
save.** `main.js` runs a coalesced autosave that marks on every action and
flushes on `pagehide`, so a state written into the slot while a mark is pending
is overwritten by the live game's own snapshot on the way out — and it looks
exactly like a save that was never written. gvb-save's flush is a no-op when
nothing is dirty, so letting the 1500 ms timer fire first is the whole fix.
`seedSave()` carries that in a comment, because the next person to write a
browser test here will hit it.

**One thing the browser found that no unit test would have.** A `page.click` on
the canvas to "focus it before typing" is itself a move — the click handler is
`act(x, y)` — so the heir walked off across the vault and the arrow keys aimed
at a square she was no longer beside. The keydown listener is on `window`; the
canvas never needed focusing.

*Model:* Claude Opus 5.

## What this leaves for a later arc

- **Levelling, XP and treasure beyond the casket.** The adventure is a vignette
  and every round has kept it one on purpose.
- **Multi-PC parties.** `selectPc` resolves one build onto `content.pc` and
  every module reads that singular; `sideOf()` has two answers. A party is not a
  fifth build; it is a new turn-order model on top of phase 1's, and it is the
  thing `heal-other` was actually asking for (#177).
- **Sound, settings, difficulty selection**, and a visual regression harness for
  `render.js` — the last would need a golden-image pipeline this project has no
  build step for.
- **Reading `Pathfinder/data/` at runtime**, forbidden until the question above
  is answered, and **anything that requires a server**: every phase here runs
  entirely in the page, which is a property worth keeping.
