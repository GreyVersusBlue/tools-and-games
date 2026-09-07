# The Absalom Inheritance

An isometric CRPG on PF2e Remaster rules. Played at
[`/Projects/absalom_inheritance.html`](../absalom_inheritance.html) — that file is the shell
(chrome, CSS, element ids) and everything else lives here.

**The URL did not move.** The board links to `/Projects/absalom_inheritance.html` and so does
anyone's bookmark, so the page stayed where it was and only its insides changed. No board edit
was needed.

## Layout

```
absalom-inheritance/
  content/vault.json          the adventure: map, creatures, commands, items, lore, tuning
  content-authoring-guide.md  how to write another one
  js/rules.js                 PF2e math. Pure, RNG injected.
  js/world.js                 grid, line of sight and line of effect, A* with rules-legal diagonals
  js/templates.js             cone, burst and emanation, as grid squares. Pure, terrain-free.
  js/conditions.js            the condition catalogue, the two funnels, the tick. Pure, RNG-free.
  js/ai.js                    one creature's turn, decided. Pure: a view in, a choice out.
  js/content.js               load and validate a pack; refuse a broken one
  js/game.js                  the run: state, turns, the reaction bus, commands. Headless.
  js/save.js                  the gvb-save slot, and repair
  js/render.js                isometric canvas renderer
  js/ui.js                    panels, log, modals, keyboard, save bar
  js/main.js                  boot and wiring
  test/smoke.mjs              968 assertions
  test/balance.mjs            Monte Carlo playthroughs; exits non-zero out of band, or on content nothing reaches
  test/autopilot.mjs          a competent player, shared by both suites
```

`rules.js`, `world.js`, `templates.js`, `conditions.js`, `ai.js`, `content.js`, `game.js` and `save.js` run under plain Node with no DOM.
That is what makes the two suites possible, and it is why nothing in the rules waits on a timer:
animation is `ui.js`'s problem, and a throttled or interrupted animation cannot desynchronise the
game from its own state.

## Running the tests

```
node Projects/absalom-inheritance/test/smoke.mjs
node Projects/absalom-inheritance/test/balance.mjs 2000
```

Both exit non-zero on failure. `balance.mjs` fails if the adventure stops being winnable, which
is not hypothetical — the build this replaced could not be finished on any seed. It now runs and
reports every build in `pcOptions` separately, and fails if any one of them is out of band.

Both also run in CI, on `.github/workflows/absalom-ci.yml`, against any commit that touches this
folder, the shell page or `assets/js/gvb-save.js`. Before that they ran in a session's terminal
and nowhere else.

## Character creation

`content/vault.json`'s `pc` (one object) is `pcOptions` (an array) — a Wizard and a Fighter today,
picked on a screen shown once, before there is a save to load. `js/content.js`'s `selectPc(pack,
buildId)` resolves the chosen build's stats and narrows `commands`/`commandById` to exactly that
build's own list, so every other module still reads `content.pc` as if there were only one PC —
none of `game.js`, `save.js`, `render.js` changed to add this. See the content-authoring guide's
§3 for the schema and the save's own `buildId` migration.

## Reactions

A turn has an interior. `game.js` fires `fireTrigger(event, ctx)` at three named points — before
a Strike is rolled, when somebody steps out of a square within a reactor's reach, and when damage
is resolved and about to land — and a reaction resolves *before* the action that triggered it
completes, by mutating `ctx`, which the triggering action reads back. One reaction per actor per
round, refreshed at the top of that actor's own turn and nowhere else.

Two ship. **Kessa** has **Reactive Strike** (Attack of Opportunity's Remaster name; Fighters have
it at 1st level), and so does **the Vault Keeper** — walking away from the Keeper costs you a
basalt fist. **Vesper** has **Shield Block**: while the Shield cantrip is up, its force disc soaks
5 physical damage and is destroyed doing it, which is what Player Core says. Neither asks
permission. The disc lapses at the start of your next turn either way, so declining it only wastes
it; the first reaction that is a real choice will need a prompt, and does not exist yet.

A reaction is a command of `kind: "reaction"`, with `triggers` and an `effect` of `strike` or
`reduce`, both validated as closed vocabularies. Creatures name theirs in a `reactions` array. See
the content-authoring guide's §4.

**The shipped creatures never provoke, and that is measured, not assumed — but the reason changed
in Phase 4.** A creature Strides to the *cheapest* open square beside you, and an optimal path to
the cheapest such square cannot cross another one on the way, so a creature that is *approaching*
enters your reach and never leaves it; `smoke.mjs` still asserts that over 3,032 planned Strides.
What is new is that a creature can now leave on purpose — the Reliquary Warden hits and backs off —
and it asks the bus first. Facing Kessa it Steps the five feet that triggers nothing rather than
Striding the twenty that would. So Kessa's Reactive Strike still fires 0 times in 2,000 seeded
playthroughs, and the zero is now a creature declining to feed it. See "What the creatures do".

Shield Block is the first thing in three rounds to move the two builds toward each other: the
Wizard's win rate went 53.6% → 64.5% against the Fighter's unchanged 79.8%. The condition
catalogue moved them apart again — 65.3% → 60.8% against 79.3% → 80.8% — and the reason is
legible: over 2,000 seeded runs per build the Keeper's critical fist stupefied the heir 239 times
as Vesper and 272 as Kessa, and cost Vesper 39 spells to the flat check and Kessa nothing at all.

**The zero above is the autopilot's, not the engine's, and Phase 3 found out how much that was
costing.** The policy put the disc up only with a last action at a multiple attack penalty of 8 or
worse; a level-1 wizard in reach of a construct wants it up every round. Widening that one rule
took reactions from 0.71 a run to 3.46 and the Wizard from 60.8% to 73.8% with no content change
at all. See "What the vault casts".

## Conditions

Eight of them, in `js/conditions.js`: `shielded`, `frightened`, `off-guard`, `clumsy`,
`enfeebled`, `stupefied`, `slowed` and `persistent-fire`. The module is pure and RNG-free — a bag
is an ordinary array of `{ id, value, until }` on the saved run, and persistent damage hands back
a spec for `game.js` to roll rather than rolling it, which is what keeps `balance.mjs` able to
replay a run.

**Two funnels, and nothing goes round either.** `roll(actor, kind, bonus, dc)` is the only `check(`
in `game.js`, and `damageFrom(actor, spec, source)` is the only `rollDamage(`. `smoke.mjs` reads
the file's own source, strips its comments and fails if a second of either appears, because the
failure mode is silence rather than a crash: a raw call rolls dice no condition can ever move and
nothing about the line looks wrong. The two deliberate exceptions are flat checks — the one that
ends persistent damage, the one Rousing Splash rolls to end it early, and the one stupefied
charges to Cast a Spell — because a flat check takes no modifiers at all (Player Core p.409).

**Nine modifier kinds**, one per number the engine actually rolls or sets: `attack-str`,
`attack-dex`, `damage`, `save-fort`, `save-ref`, `save-will`, `ac`, `perception` and `spell-dc`.
The splits are not decoration. Enfeebled is a Strength penalty and clumsy a Dexterity one, so a
single `attack` kind makes Vesper's finesse dagger and Kessa's longsword the same weapon; clumsy
is Reflex and stupefied is Will, so a single `save` kind makes both of them frightened with
another name. A command says which ability swings it (`"ability": "dex"` on the dagger; `str` is
the default, so no pack that predates the field had to change).

**Slowed is the one that reads the bag outside the funnel.** It moves no number: it takes actions
off the top of a turn, in `advance()` for the PC and in `creatureTurn` for a creature, both read
*after* that actor's start boundary so a condition expiring there is not still charging for it.

**Immunities are content.** A creature lists them (`"immunities": ["mental"]`), a condition
carries traits, and every construct in this pack refuses `frightened` out loud — a button that
does nothing is a bug report, and a rule the player is told is a rule they can use.

Durations tick in exactly one place, at the top of `advance()`, each bag as its own owner against
whoever's boundary it is, because "expires at the start of your next turn" can name an actor other
than the one wearing it. A condition applied by content gets its duration from the catalogue
rather than from the pack (`defaultUntil`), which is what stops a pack that forgot to write one
from stapling a −2 to the heir for the rest of the delve. Conditions are in the save additively:
`pc.conditions` and a per-creature `conditions`, repaired on every load, absent entirely from a
save with none (#36, #37).

See the content-authoring guide's §5 for `inflicts`, `ends`, `ability` and `immunities`.

## Areas: cone, burst and emanation

Three shapes, in `js/templates.js`, and it is the purest module in the project: grid squares in,
grid squares out, no world, no content, no state, no terrain. Areas are Player Core p.387.

**`coneSquares(origin, target, feet)`** is the quarter circle the rule actually names. The click
snaps to one of eight grid directions at the 22.5° octant boundary, and the shape is cut to range
by `feetBetween` — the same alternating 5/10/5 measurement every other distance in this game uses.
Two consequences are visible on the board and both are deliberate: the caster's own square is never
in her own cone, and an orthogonal cone is smaller than a diagonal one (11 squares against 12 at 15
feet). The second is the diagonal rule showing through, not an error; a shape that came out the same
size both ways would be one that had stopped measuring in feet.

**`burstSquares(centre, feet)`** spreads from a chosen square, centre included.
**`emanationSquares(origin, feet)`** spreads from you. At the one creature size this engine has —
every actor stands in a single square — those two are the same set, and `smoke.mjs` pins the
equality rather than letting two names for one shape drift apart. What differs is the targeting, and
that lives in `game.js`: a burst's centre is anywhere you have range and line of effect to, an
emanation's is always you.

**One knowing departure**, flagged the way Force Fang's is. The book measures a burst from a corner
and an emanation from the edge of your space; this engine measures square centres, because it has no
corners anywhere — targeting, line of sight and the A* all address squares — and a second coordinate
system for templates alone would be a second geometry to keep in step with the first.

**`game.templateSquares(cmd, target)` is the only caller of any of the three**, and both the
resolution and `render.js`'s aim preview read it. That is the whole reason it exists. The cone used
to be written twice: `game.js` resolved "within `coneFeet` and within ±45° of the clicked bearing",
and `render.js` previewed one from its own inline copy of the same trigonometry with the range
hardcoded to `feet > 15`. They agreed only because Breathe Fire is a 15-foot cone. A 30-foot one
would have painted one shape and burned another, and nothing would have thrown. `smoke.mjs` reads
both files' source and fails on a `Math.atan2` in either, the same drift guard the two funnels have.

## Line of sight, line of effect

They are two questions now and the gate is what separates them. `blocksSight(x, y)` takes no gate
argument at all: the gate is a portcullis, and the two empty seal-recesses flanking it are meant to
be read from this side. `blocksEffect(x, y, gateOpen)` is the one that stops at a shut gate, and
`hasLoE` is what every area and every unerring spell filters through. So the heir can see the Vault
Keeper's chamber through the bars and cannot put a Force Fang into it.

`world.reachableFrom(ox, oy, squares, gateOpen)` is the only place a shape meets terrain: on the
grid, not inside a solid, line of effect from the origin. It is why the four wall blocks flanking the
pillars now throw a shadow across a cone, the same way they already broke a sentinel's line of sight.

## What the vault casts

Vesper carries all three shapes. **Breathe Fire** is the 15-foot cone, unchanged. **Ember Burst**
is a 10-foot burst placed anywhere within 30 feet and spends a rank-1 slot; **Warding Pulse** is a
one-action 10-foot emanation cantrip. Both are this pack's own spells rather than book ones, said so
in their notes, and both exist because a template kind with no command is a kind nobody plays.

The numbers were measured, not chosen. Over 2,000 seeded runs per build:

| | wizard | fighter | reactions per run |
| --- | --- | --- | --- |
| before this phase | 60.8% | 80.8% | 0.71 |
| both new spells in the pack, both never cast | 60.8% | 80.8% | 0.71 |
| the disc rule widened, old kit | 73.8% | 80.8% | 3.46 |
| shipped | 82.8% | 80.8% | 2.15 |

**The second row is the finding worth keeping.** Both new spells validated at load, appeared in the
command list, and were cast zero times — the win rate came back bit-identical to the build before
them, to every decimal. That is the third time in two phases this project has shipped content
nothing reaches, so `balance.mjs` counts casts per command now and **exits non-zero when a build's
command is never cast at all**. A note that only prints is a note that gets scrolled past (#13).

**The third row is not content at all**, and the split matters. Getting the pulse to fire displaced
Shield, and Shield Block went with it: 4,143 casts and 0.71 reactions a run became 0 and 0.00. The
same guard caught that on the same run. The fix is a policy that was too narrow to begin with —
`autopilot.mjs` gave the last action of a melee turn to the disc only at a multiple attack penalty
of 8 or worse, where a level-1 wizard with a construct in reach wants the disc up every round
whatever her MAP is. Widening it is worth 13 points on its own, against 9 for the two new spells.
**The heir was always this survivable; the harness had been playing her badly.**

Warding Pulse costs one action because the turn holds three: Strike, ring, disc. At two actions
there is no room for the disc and Shield goes back to being a thing the policy owns and never uses.
It rolls a flat 1d4 because 1d4+2 measures 86.7% against a band ceiling of 90%.

Kessa's number does not move at any row, because she has no spells and got none. That left the two
builds within a point of each other, which the phase below opened back up from the other side.

## What the creatures do

**`js/ai.js` is `chooseAction(view)` and nothing else.** A view in, a choice out: no world, no RNG,
no state, nothing it can mutate. Every fact it ranks was measured first by `game.js`'s `situation()`
— is the heir in reach, does a retreat leg exist, would Striding it provoke, how many squares would
this template catch and how many of its own are standing in them — and the turn then walks *that*
plan rather than planning a second time. Two copies of the cone once agreed only because Breathe
Fire is 15 feet; a policy with its own geometry would be the same bug with a longer fuse.

Three policies, one pack field, `ai`, absent meaning `brawler`:

| | who | what it does |
| --- | --- | --- |
| `brawler` | both Shattered Sentinels | if adjacent, Strike; else Stride. The strategy every creature played before this phase, kept as the default so a pack written before it needs no edit. |
| `skirmisher` | the Reliquary Warden | Strike once, then get out of reach and stay out for the rest of the turn. |
| `caster` | the Vault Keeper | open with an area ability the heir is standing in and its own escort is not; otherwise punch. |

**A skirmisher only leaves when leaving is free**, and how it leaves depends on who it is facing.
Against Vesper it Strides the full 20 feet. Against Kessa it Steps 5 — a Step triggers nothing
(Player Core p.418), and Kessa is holding Reactive Strike. It works that out by asking the reaction
bus: `provokedBy()` builds the bus's own ctx and calls `reactionBlocked()` for every square of the
walk, so it cannot drift from what the bus would actually do. With no Step available and a Stride
that would provoke, it stands and fights.

**The Keeper's Gravel Wave is the engine's first template thrown *at* the heir.** 2 actions, a
15-foot cone from the creature's square, 2d6 bludgeoning, basic Reflex, off-guard on a critical
failure, once per encounter. Its DC is **16, written on the command**, not the heir's spell DC of
17: a construct has none to borrow, and a stupefied Vesper must not make a floor easier to dodge.
An area command now carries either `spell` or its own `dc`, and refuses to carry both (#157, which
amends #152). No build lists the command, so no heir can cast it — a creature reads its abilities
out of the pack's whole command list, exactly as it reads its reactions.

Measured over 2,000 seeded runs per build, with the two causes separated:

| | wizard | fighter |
| --- | --- | --- |
| before this phase | 82.8% | 80.8% |
| the skirmisher alone | 82.8% | 81.2% |
| the Keeper's cone alone | 81.2% | 74.7% |
| shipped | **81.4%** | **75.1%** |

**Hit and run measured neutral.** The action the warden spends backing off costs it about what it
costs her; what it changes is the shape of the fight, not who wins it — the median wizard encounter
runs 14.3 rounds before and 15.2 after. All of the movement is the cone, and it lands twice as hard
on Kessa, who has no disc to soak it and a point less of both AC and Reflex.

**Kessa's Reactive Strike still fires zero times in 2,000 runs, and now that is a decision rather
than an absence.** Nothing could leave her reach before, because `planApproach` cannot walk out of
one. Something can now, and takes the Step instead.

## The save

Storage key **`absalom-inheritance-save-v1`**, schema version 1. Locked decision #36: that key is
permanent.

Persistence is through the shared `assets/js/gvb-save.js`, so the game gets localStorage, export
to a file, import back, a memory fallback where storage is blocked, and one implementation of
"refuse to load garbage". The save bar is in the left panel rather than behind a title screen, so
exporting mid-delve does not mean reloading the page.

What survives a reload: which build was chosen, position, HP, spell slots, focus, every creature's
HP and whether it is awake, which pillars have been read, whether the gate is open, the fog-of-war
memory as a 484 character bitfield, the satchel, the last 60 log lines, and the run statistics
(which grew a `reactions` count, repaired to 0 on a save written before reactions existed).
A save with no `buildId` at all predates character creation and migrates onto `pcOptions[0]` — the
one build that existed when every such save was written.

What does not: the initiative order, or anyone's reaction. Both live on the runtime `turn`
object — a reaction is spent inside a turn, and a save restored mid-encounter re-rolls initiative
anyway. A save restored mid-encounter re-rolls it. Rebuilding a
half-finished round is more machinery than it is worth, and a player who reloads to escape a bad
initiative could equally reload to escape a bad damage roll — that is inherent to autosaving a
dice game in a browser, not something this design introduced.

`repair` runs on every accepted load and fills in or clamps every field from content, including
ones that cannot be missing today. That is deliberate: the version where they *can* be missing is
the whole reason the hook exists.

## Rules notes

Proficiency is level + rank. Degrees of success step on a natural 1 or 20. Diagonals cost
5/10/5 and the A* carries diagonal parity in its node key so path costs are exact. MAP is −4/−8
for the agile dagger and −5/−10 otherwise. Basic saves scale none/half/full/double.

Two knowing departures, both flagged in `content/vault.json`:

* **Force Fang** is a Magus focus spell (Secrets of Magic), not a wizard one. Kept from the
  original design spec.
* **Templates measure square centres**, where the book measures from a corner of a square or the
  edge of your space. See "Areas" above for why, and for what the cone actually is now.

Six conditions in this pack are hung off rolls the book leaves bare, and all six are flagged in
`content/vault.json` and measured rather than guessed: a critical dagger leaves a construct
clumsy, a critical longsword leaves it enfeebled, Force Fang slows whatever it hits, a critical
sentinel fist leaves the heir off-guard, a critical Basalt Fist leaves her frightened *and*
stupefied, and the Reliquary Warden's fist is fire that can set her alight. A condition system
nothing in the adventure applies is a system nobody plays.

## Accessibility

The whole adventure is finishable without a pointer. Arrow keys or WASD move a cursor, Enter acts
on it, Tab cycles between creatures, unread pillars and the casket, number keys fire commands, `E`
ends the turn, `I` opens the satchel, `Escape` cancels an armed command or closes a modal. A
reaction has no number key, because there is nothing to press: its row shows whether it is still
up and the bus fires it. Items
move with the arrow keys and discard with Delete. A live region announces what the cursor is over.

Below 900px the three columns become one stack with a tab bar. The board gets the full viewport
width; the whole 22×22 map fits at 375px.
