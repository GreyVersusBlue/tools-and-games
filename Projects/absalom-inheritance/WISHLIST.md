# The Absalom Inheritance — Feature Wishlist

**Status: Phase 1 — the interrupt point — has shipped.** The turn loop has a
seam. `fireTrigger` is called at three named points, `content.js` validates a
`reaction` command kind against those three names and two effects, and a
creature turn is a generator the caller drains rather than one function that
returns when it is over. Kessa carries Reactive Strike, Vesper carries Shield
Block, and the Vault Keeper answers a Stride out of its reach with a basalt
fist. `test/smoke.mjs` reports **425 passed, 0 failed**, up from 308, and
seventeen guard-rails were broken on purpose (#34) and each exited 1 from a
green baseline. `test/balance.mjs` over 2000 seeded runs a build: **Wizard
64.5%** (from 53.6%) and **Fighter 79.8%** (unchanged to the decimal). The next
open phase is Phase 2 — conditions that expire — on Claude Fable 5.1.

Round one made an unwinnable vignette winnable and broke the single file into ES
modules; round two added a second area and caught a stall bug with a Monte Carlo
harness that a browser playthrough never would have; round three added character
creation and a second build, tuned across three measured passes; round four built
the interrupt point every previous round had deferred.

## What it is

An isometric, turn-based CRPG on Pathfinder 2e Remaster rules, played at
`/Projects/absalom_inheritance.html`. That file (412 lines) is the shell —
chrome, CSS, element ids, four modal veils — and everything that matters lives
next door in `Projects/absalom-inheritance/`. No build step, no dependencies,
nothing vendored: plain ES modules and a canvas, which does have to be *served*,
because a browser refuses ES modules over `file://`.

The whole adventure is one JSON file. `content/vault.json` (342 lines) carries
two areas drawn as ASCII rows with a per-area legend — a 22×22 vault and a
14×10 sanctum reached by a stairway past the Keeper — three creature stat
blocks placed four times between them, seven commands, five item types, three
lore pillars and two buildable PCs. The engine reads shapes, never ids: a second
area's guardian is an ordinary entry in `creatures`.

What it does well is the rules. `rules.js` is real PF2e math with page
references: degrees stepping on a natural 1 or 20, basic saves scaling
none/half/full/double, MAP at −4/−8 for the agile dagger and −5/−10 otherwise,
5/10/5 diagonals carried into A*'s node key so a path's feet are exact. Every
roll goes through an injected RNG, which is what makes 2000 headless seeded
playthroughs possible in a few seconds.

What it is not: it is twelve to sixteen minutes long. Two rooms, four mandatory
fights, three lore pieces, one rest, one casket. No conditions, no reactions, no
templates, no ranged attack that can miss, and no creature intelligence beyond
"walk at the PC and swing." A creature's whole turn resolves inside one
synchronous function with nothing able to say "wait."

## The architecture that is there

Bottom-up. Everything from `rules.js` through `save.js` runs under plain Node
with no DOM, and that is the load-bearing habit of the project: it is why two
test suites exist at all.

- **`js/rules.js` (145)** — the PF2e math and nothing else: `degreeOfSuccess`,
  `check`, `basicSaveDamage`, `mapPenalty`, `feetBetween`, `stridesFor`,
  `parseDamage`, `makeRng`. Pure, RNG injected.
- **`js/world.js` (209)** — one area's grid. `TILE` (FLOOR, WALL, GATE, PILLAR,
  TREASURE, STAIRS), Bresenham `hasLoS`, `fieldOfView`, an eight-way `findPath`
  whose node key carries a diagonal parity bit, `planApproach` (the one creature
  stride planner, shared with the suite), and the fog bitfield the save writes.
- **`js/content.js` (330)** — `loadPack` parses and *refuses*: a broken pack
  throws a `ContentError` with a sentence. `selectPc(content, buildId)` resolves
  a many-build pack down to the one-PC shape every other module still reads.
- **`js/game.js` (1,126)** — the run. Persistent `run` state, a runtime-only
  `turn` object, the reaction bus, triggers, and every command the player can
  fire. Headless: an action resolves instantly and hands back a playback script.
- **`js/save.js` (254)** — the gvb-save slot (`absalom-inheritance-save-v1`,
  schema 1) plus `makeRepair`, which resolves and clamps every field on every
  load. `migrate` exists and is empty.
- **`js/render.js` (301)** — isometric canvas from diamonds and prisms, no art
  assets, one `requestAnimationFrame` loop. **`js/ui.js` (616)** — panels, log,
  four modals, the keyboard cursor, the save bar, and `pickCharacter`, built
  entirely from `content.pcOptions`. **`js/main.js` (101)** — boot: fetch the
  pack unresolved, load a save or run the picker, `selectPc` once, autosave.
- **`test/smoke.mjs` (1,490)** — 425 assertions across rules, world, content,
  game, reactions and save. **`test/autopilot.mjs` (248)** — a competent player as code,
  generic over command *kind* rather than id. **`test/balance.mjs` (117)** — N
  seeded playthroughs per build, band-checked independently, non-zero exit if
  any build leaves the band.

Where it breaks down: **`game.js` is still the only module without a seam,**
and it is 1,126 lines now rather than 834. State, turn order, the bus,
movement, seven command kinds and the inventory all live in one closure. A turn
has interior structure at last, which was the whole point of Phase 1; splitting
the closure itself is still nobody's phase.

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
node Projects/absalom-inheritance/test/smoke.mjs        → 425 passed, 0 failed — SMOKE OK
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
- **Does the adventure grow, or does the engine deepen?** Twelve to sixteen
  minutes, two rooms, four fights. Arc one deepens the engine on the rooms that
  exist; arc two spends the same effort on more rooms. The order is a taste
  question, not a technical one.

## The standing backlog

Everything here is open and unclaimed. Add to this list rather than starting a
new one.

**The turn loop**
- Reactions exist and there are two of them. What there is not: **Step, Delay,
  Ready, or declining a reaction.** Every reaction fires automatically, which is
  right for the two that ship (Shield Block's disc lapses at the start of your
  next turn either way, so declining only wastes it) and wrong for the first one
  that is a real choice. Torchbearer's `askReaction` is the model.
- **No creature ever provokes.** `world.planApproach` walks to the *cheapest*
  square beside the PC, and a path to the cheapest such square cannot cross
  another one on the way — so a creature can enter your reach and never leave
  it. Kessa's Reactive Strike is correct and fires zero times in 2000 seeded
  runs. Phase 4 is what changes that; `smoke.mjs` asserts the zero and will say
  so when it does.
- `turn.shielded` is a boolean on a runtime object, the engine's only status
  effect, and deliberately not saved. `turn.reaction` and `turn.reacted` sit
  beside it and are not saved either. Initiative is not saved; a mid-encounter
  reload re-rolls it.

**Rules and conditions**
- No conditions at all: no frightened, off-guard, slowed, clumsy, enfeebled, no
  persistent damage, no dying/wounded. Every `check()` call site takes a flat
  bonus with nowhere for a condition's modifier to come from. No flanking, cover
  or concealment either — `hasLoS` answers yes or no.
- Six command kinds: `attack`, `self-buff`, `self-heal`, `cone`, `unerring`,
  `consume`. No heal-another, no debuff, no ranged attack that rolls to hit.
- Damage types are strings printed in the log; nothing reads them for
  resistance, weakness or immunity.

**Geometry and the grid**
- The cone is "within range and within ±45° of the bearing you clicked," not a
  PF2e template — documented in the README rather than pretended. `render.js`
  re-implements that math inline for the aim preview *and hardcodes 15 feet*, so
  a second cone at any other range would preview wrong and resolve right.
- No bursts, emanations or lines. `hasLoS` is line of sight; PF2e's line of
  *effect* is a different question nothing asks.
- `findPath`'s open set is a `Map` scanned linearly for the lowest `f` —
  quadratic in the node count, and the first thing a larger area finds.

**Content and the pack**
- A second area cost six files (guide §11 lists them); a third costs the same
  six. The pack format is data; the engine's idea of what an area *may contain*
  is not. There is exactly one pack, fetched by a literal URL in `main.js`.
- `startingInventory` is pack-level, so every build carries the same satchel —
  which is how the Fighter came to exist (the longsword was already in it).
- Two builds; the picker needs no edit for a third. No shops, no levelling, no
  XP, no downtime — deliberately.

**Creatures and AI**
- `runCreatureTurn()` is: if adjacent, Strike; else Stride toward the nearest
  open square beside the PC. Nothing retreats, shoots, avoids a cone, focuses a
  wounded PC, or coordinates with anything else.
- `checkDisengage()` heals a settled creature to full as anti-cheese. Nothing
  can be worn down across two engagements. Three stat blocks, four placements,
  one boss per area.

**Surface and accessibility**
- `transitionTo()` writes a narrative line and emits `area` but never calls
  `setHint()`, so the hint bar still reads what it said in the room you left;
  `ui.js`'s `area` handler refreshes everything except that one string.
- The PC draws in the same blue palette regardless of build. No sound, no
  settings, no difficulty selection.

**Tests and the harness**
- `balance.mjs` reports one aggregate per build. It cannot answer "which fight
  kills people" or "did this change move the Keeper fight specifically." No
  baseline is stored, so a 3-point drift is invisible until it crosses a band
  edge.
- No suite covers `render.js` or `ui.js`; both are DOM-bound and untested.
- The autopilot brawls everything and never uses the cover a player would, so
  every number it reports is a floor rather than a ceiling.

## Arc one — the turn that can be interrupted

Arc one builds for the player who has read a PF2e rulebook and keeps reaching
for verbs the game does not have — the reaction, the condition, the template.
Every phase in it is engine work on the two rooms that already exist rather than
new content. **Ranked by impact, and the order is the recommendation**:
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

- [ ] **`js/conditions.js`, pure, with its suite.** A condition is
      `{ id, value, until }`; a bag of them answers three questions — what it
      does to a check, what it does to damage, what has expired. RNG-free.
- [ ] **One funnel per modifier.** Every `check()` in `game.js` routes its bonus
      through `modifiersFor(actor, "attack" | "save" | "ac" | "perception")`,
      and `turn.shielded` becomes an ordinary condition. That deletion is the
      proof the funnel is real.
- [ ] **Durations that tick in exactly one place** in `advance()`, in the
      actor's own turn boundaries, with an expiry writing a log line rather than
      vanishing silently. **Persistent damage** first, since it exercises the
      tick path harder than the static conditions do.
- [ ] **Conditions in the save, additively.** `pc.conditions` and per-creature
      `conditions` arrays, dropped by `repair` if content no longer defines
      them, absent entirely from a save with none. A `repair` migration, not a
      version bump.
- [ ] **On the sheet and in the live region.** Chips with their values, a
      marker over an afflicted creature, an announcement on gain and loss — a
      debuff a screen-reader user cannot hear is not a mechanic.
- [ ] **The test that pins it.** A condition at value 2 ticking to 0 and
      expiring on the right boundary; a save round trip carrying conditions; a
      legacy save with no `conditions` key loading clean. Then `balance.mjs`.

*Leans on:* `rules.js`, `game.js`'s check sites, `save.js`'s `repair`,
`ui.js`'s `refresh`. *Save:* additive per-actor `conditions`, repaired against
content, no version bump. *Model:* **Claude Fable 5.1** — a new pure model layer
with subtle invariants that every check and damage path inherits, plus a save
shape that is permanent once written.

## Phase 3 — Templates, and line of effect

**The cone is a 90-degree wedge with a comment apologising for it, and
`render.js` draws a different one from its own copy of the math.**

The README flags the approximation honestly, which beats pretending. The
duplicate in `render.js` is the bug in waiting: it re-implements the bearing
test inline and hardcodes `feet > 15`. Breathe Fire is 15 feet, so preview and
resolution agree today by coincidence.

- [ ] **`js/templates.js`, pure, with its suite.** `coneSquares(origin, bearing,
      feet)` implementing the real PF2e template, plus `burstSquares` and
      `emanationSquares`. Grid squares in, grid squares out.
- [ ] **One caller each.** `game.js`'s `cone` branch and `render.js`'s aim
      preview both call it; both inline copies of the trigonometry are deleted,
      and the hardcoded 15 goes with them.
- [ ] **Line of effect, distinct from line of sight.** `world.js` grows
      `hasLoE` — a gate blocks it even when you can see through — and every
      template filters through it. **`burst` and `emanation`** join `cone` as
      validated command kinds, one pack command each so they ship exercised.
- [ ] **The test that pins it.** Assert the cone's square count against the
      published template at 15, 30 and 60 feet; assert the preview set and the
      resolution set are identical for a seeded aim; break the hardcoded range
      on purpose first and watch it fail. Then `balance.mjs` — this moves
      Breathe Fire's real hit rate, so the Wizard's number should shift and the
      Fighter's should not.

*Leans on:* `world.js`, `game.js`'s `useCommand`, `render.js`'s aim preview,
`content.js`'s validator. *Save:* none. *Model:* **Claude Fable 5.1** — grid
geometry where a wrong square is silent, and the one place a preview and a
resolution can disagree without anything erroring.

## Phase 4 — Creatures that know what they are standing in

**Every creature in this game plays the same one-line strategy: walk at the
player and swing.**

`runCreatureTurn()` is twenty lines and its whole policy is "if adjacent,
Strike; else Stride toward the nearest open square beside the PC." Correct while
a creature had nothing else to do. After phases 1 through 3 it has three things
to do — take a reaction, apply or dodge a condition, stay out of a template.
Fourth and not first, because an AI written before the verbs exist is an AI
rewritten when they arrive.

- [ ] **Lift the policy out of the loop.** `creatureTurn(c, view)` returns a
      chosen action; `runCreatureTurn()` executes it and builds the script. Same
      output shape, one decision point.
- [ ] **A per-creature `ai` field in the pack** — `"brawler"` (today's
      behaviour, the default, so `vault.json` need not change), `"skirmisher"`,
      `"caster"`. Validated in `content.js`; an unknown value is refused.
- [ ] **Reaction awareness**, so a creature that would provoke asks whether the
      reaction is worth eating, and **target selection worth the name** —
      whether it prefers the wounded, the caster or whoever hit it last is a
      content field.
- [ ] **Give the Vault Keeper a real kit.** It is the first boss and currently
      Strides and Strikes like a sentinel. A reaction and a template, tuned with
      the harness rather than by feel.
- [ ] **The test that pins it.** A seeded encounter where a `skirmisher`
      demonstrably steps away rather than trading; the Keeper's kit firing at
      least once across a batch. Then `balance.mjs` at 2000 on both builds — the
      Wizard is the closer of the two to the floor at 53.6%.

*Leans on:* phases 1–3, `game.js`'s `runCreatureTurn`, `content.js`'s creature
validator, `test/balance.mjs`. *Save:* none — AI is a content field, not run
state. *Model:* **Claude Opus 5** — decision policy with a 2000-run measuring
stick pointed straight at it, which is the opposite of a silent wrong answer.

## Phase 5 — A harness that says which fight killed you

**`balance.mjs` reports one number per build, and one number cannot tell you
whether the Keeper is too hard or the sanctum is free.**

The harness has paid for itself twice, on the unwinnable original build and on
round two's post-combat stairs stall, and both times it worked because it
produced a number. After four phases of engine change it needs to produce more
than two of them.

- [ ] **Per-encounter reporting.** Tag each encounter with its area and the
      creature that started it; report win rate, rounds and damage taken per
      encounter rather than per run.
- [ ] **Per-area reporting.** How often a run reaches the sanctum, how often it
      dies there, what share of total damage the last room accounts for. Today
      "read the reliquary 25.5%" is the only sanctum signal there is.
- [ ] **A stored baseline** in `test/baseline.json`, written by an explicit flag
      and compared every run, so a move from 53.6% to 50.1% reports a 3.5-point
      regression instead of passing quietly inside a 45-point band.
- [ ] **Reaction and condition counters** — how often each fired and by whom,
      the cheapest way to catch a feature that is wired but never triggers — and
      a **build × area matrix** printed as one table, so four builds do not
      double the output length.
- [ ] **The test that pins it.** Break one encounter's numbers on purpose and
      confirm the harness exits non-zero naming that encounter — locked decision
      #34 applied to the harness itself.

*Leans on:* `test/balance.mjs`, `test/autopilot.mjs`, `game.js`'s `run.stats`.
*Save:* none. *Model:* **Claude Opus 5** — reporting and test wiring around a
harness pattern that already works.

## Arc two — more adventure than engine

Arc one deepens two rooms. Arc two makes rooms cheap. It builds for the person
who wants to *write* an adventure for this engine rather than extend it: guide
§11 is honest that a second area cost six files and a third costs the same six,
which means the pack format is data and the engine's idea of what an area may
contain is not. Same terms as arc one — **ranked by impact, the order is the
recommendation**, same model convention, same definition of finished. How much
new content the third area carries turns on Devon's answer to the third question
above; phase 6 makes it cheap either way.

## Phase 6 — An area should be a file, not a diff

**Adding the sanctum touched `content.js`, `game.js`, `save.js`, `render.js`,
`ui.js` and `vault.json`, and the guide says a third area costs the same six.**

None of those six changes were about the sanctum. They were about the engine
learning that "more than one area" was a shape. That work is done; the cost was
not paid off with it. The engine still knows a fixed list of what a legend tile
may be and what a pack may contain, and there is exactly one pack.

- [ ] **A tile-kind registry.** `world.js`'s `TILE` and `content.js`'s legend
      parser read one table instead of two hardcoded lists; a new kind declares
      its own blocks-move / blocks-sight / blocks-effect answers, opting *out*
      of solidity, never in.
- [ ] **Per-area `tuning` overrides.** `visionFeet`, `noticeFeet` and
      `standardDC` are pack-global; a dark room should be a content decision.
- [ ] **More than one pack.** `main.js` fetches `vault.json` by a literal URL.
      Give the loader a manifest and a deliberately tiny second pack that proves
      a pack is portable and gives `smoke.mjs` a fixture it can break freely.
- [ ] **`packId` with teeth** — `repair` carries it already; make it refuse a
      save written against a different pack, with a sentence a player can read.
- [ ] **A third area as the proof.** One legend, one grid, creatures from the
      existing stat blocks, one lore pillar, and — per round two's honest note
      that a fourth mandatory fight is what puts the Wizard at 53.6% — one
      *optional* encounter with a reward rather than another compulsory one. If
      it costs more than a content file and a guide rewrite, this phase is not
      finished.
- [ ] **The test that pins it.** Both packs loaded in `smoke.mjs`; the new area
      played end to end through `playThrough()`; a cross-pack save refused
      rather than silently repaired; `balance.mjs` at 2000 with phase 5's
      per-area report confirming the new room is neither free nor a wall.

*Leans on:* `content.js`'s `loadPack`, `world.js`'s `TILE`, `main.js`'s fetch,
`save.js`'s `repair`, `content-authoring-guide.md` §11. *Save:* no shape change;
`packId` gains enforcement it already had a field for. *Model:* **Claude Opus
5** — `loadPack`'s validate-and-refuse pattern already exists and the guide
already specifies the shape; this extends a validator against a 308-assertion
net rather than designing a schema.

## Phase 7 — Two more heirs, with their own satchels

**The picker is built entirely from `pcOptions` and has never been asked for a
third card.**

Round three said it plainly: a third build costs far less than the picker did,
and the one worth having exercises a command kind the engine lacks rather than
being another striker. After arc one those kinds exist. A Cleric heals someone
other than itself; a Rogue debuffs and wants off-guard to mean something.

- [ ] **`heal-other` and `debuff` command kinds**, validated in `content.js`,
      resolved in `useCommand` — the first commands here that target a creature
      with something other than damage.
- [ ] **Two builds in `pcOptions`**, a support and a skirmisher, each tuned
      across measured passes. Expect three iterations; that is what both
      existing builds took.
- [ ] **`startingInventory` moves to per-build with a pack-level default.**
      Round three skipped this because two builds were happy sharing a satchel;
      four are not, and a non-caster carrying a spellbook is the kind of detail
      this project otherwise gets right.
- [ ] **The autopilot learns the new kinds** — `findUsable(game, "heal-other")`
      and `"debuff"` in `combatPolicy()`, with no branch naming a build. The
      generic-over-kind property is the thing worth protecting. Check the picker
      still stacks to one column at 375px at four cards.
- [ ] **The test that pins it.** A 40-seed `playThrough()` per new build, the
      way the Fighter was pinned, then `balance.mjs` at 2000 across all four
      with phase 5's matrix carrying the output.

*Leans on:* `content.js`, `content/vault.json`, `test/autopilot.mjs`,
`ui.js`'s `pickCharacter`. *Save:* per-build `startingInventory` changes what a
fresh run gets, not what a save carries. *Model:* **Claude Opus 5** — content
tables and one policy branch on mechanisms arc one already built and tested.

## Phase 8 — The debts on the surface

**A stairway swaps the whole board out and the hint bar still describes the room
you left.**

Small, real, and each carried forward at least one round because no session was
already in the file. Batch them so one session pays the cost of opening `ui.js`
and `render.js` once.

- [ ] **The hint bar on transition.** `transitionTo()` emits `area` and writes a
      narrative line but never calls `setHint()`; `ui.js`'s `area` handler
      refreshes the panel, the cursor and the aim and leaves `#hint` alone. One
      line each, named in every set of notes since round two.
- [ ] **The PC looks like the build.** `render.js` draws the same blue prism for
      a Wizard and a Fighter; a palette per build, read from `pcOptions`.
- [ ] **Reactions and conditions styled in the log**, if phases 1 and 2 left
      them as plain entries, and **a keyboard pass over every verb the arc
      added** — the README's claim that the adventure is finishable without a
      pointer is a promise, and new verbs are how such a promise stops being
      true.
- [ ] **The test that pins it.** DOM assertions through `window.__absalom` and
      dispatched events for the hint bar after a transition and for every new
      control's keyboard path (locked decision #39).

*Leans on:* `ui.js`, `render.js`, `absalom_inheritance.html`. *Save:* none.
*Model:* **Claude Opus 5** — surface wiring against ids that already exist.

## What this leaves for a later arc

- **Levelling, XP and treasure beyond the casket.** The adventure is a vignette
  and every round has kept it one on purpose.
- **Multi-PC parties.** `selectPc` resolves one build onto `content.pc` and
  every module reads that singular. A party is not a fifth build; it is a new
  turn-order model on top of phase 1's.
- **Sound, settings, difficulty selection**, and a visual regression harness for
  `render.js` — the last would need a golden-image pipeline this project has no
  build step for.
- **Reading `Pathfinder/data/` at runtime**, forbidden until the question above
  is answered, and **anything that requires a server**: every phase here runs
  entirely in the page, which is a property worth keeping.
