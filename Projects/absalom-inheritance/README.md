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
  js/world.js                 grid, line of sight, A* with rules-legal diagonals
  js/content.js               load and validate a pack; refuse a broken one
  js/game.js                  the run: state, turns, the reaction bus, commands. Headless.
  js/save.js                  the gvb-save slot, and repair
  js/render.js                isometric canvas renderer
  js/ui.js                    panels, log, modals, keyboard, save bar
  js/main.js                  boot and wiring
  test/smoke.mjs              425 assertions
  test/balance.mjs            Monte Carlo playthroughs, exits non-zero out of band
  test/autopilot.mjs          a competent player, shared by both suites
```

`rules.js`, `world.js`, `content.js`, `game.js` and `save.js` run under plain Node with no DOM.
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

**The shipped creatures never provoke, and that is measured, not assumed.** A creature Strides to
the *cheapest* open square beside you, and an optimal path to the cheapest such square cannot cross
another one on the way — so a creature enters your reach and never leaves it. Kessa's Reactive
Strike fires 0 times in 2000 seeded playthroughs; the Keeper's fires against a player, which the
autopilot is not. `smoke.mjs` asserts the zero over 3,032 planned Strides so the next phase that
gives a creature a reason to reposition is told the rule has come alive.

Shield Block is the first thing in three rounds to move the two builds toward each other: the
Wizard's win rate went 53.6% → 64.5% against the Fighter's unchanged 79.8%.

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
* **The cone** is "within range and within ±45° of the bearing you clicked", not a true PF2e cone
  template. The renderer paints the affected squares before you commit.

## Accessibility

The whole adventure is finishable without a pointer. Arrow keys or WASD move a cursor, Enter acts
on it, Tab cycles between creatures, unread pillars and the casket, number keys fire commands, `E`
ends the turn, `I` opens the satchel, `Escape` cancels an armed command or closes a modal. A
reaction has no number key, because there is nothing to press: its row shows whether it is still
up and the bus fires it. Items
move with the arrow keys and discard with Delete. A live region announces what the cursor is over.

Below 900px the three columns become one stack with a tab bar. The board gets the full viewport
width; the whole 22×22 map fits at 375px.
