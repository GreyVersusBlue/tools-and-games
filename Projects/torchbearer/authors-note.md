# Author's note: writing Cold Harrow through the contract

Phase 8's fourth bullet asked for a second full adventure "written *only*
through the contract by someone who changes no engine code", and its fifth asked
for one honest page on how that went. This is the page. It is written after the
fact, from the actual order things happened in, and it names the things that did
not work.

`packs/cold-harrow.json` is 20 scenes, 3 encounters, 5 monsters, 3 items and a
companion. `packs/harrowmoor-bestiary.json` is ten more monsters, levels 1 to 6,
with no scenes at all. Neither one required a line of `torchbearer.html`, and
the suite proves it rather than claiming it: none of Cold Harrow's 33 ids is
named anywhere in the page.

## What was easy

**The scene graph.** Prose, a list of choices, a `goto` on each. Cold Harrow has
four skill checks, three endings and a hub scene that opens a third path only
for a hero who read a ledger two acts earlier, and none of that needed anything
but `if`, `goto`, `check` and `flagOnce`. The flag grammar in particular held
up: `debt-cleared` is set by one scene's `onEnter` and read by one choice's
`if`, and there was never a moment of wondering how.

**Reusing the vocabulary rather than inventing one.** `"kind": "shop"` and
`"kind": "explore"` both did exactly what §11 says they do on the first
attempt. So did `bossFlags`, which turns "the hero learned the thing's name" and
"the hero broke its arithmetic" into two different, stacking debuffs on the same
boss without a line of code.

**The treasure budget.** 97 gp of 125 at level 3, and the validator says so
immediately. This is the field that would otherwise be a slow argument with
yourself.

## What needed the guide open

**The opener flags.** Which five exist, what each does, and — the part that is
not obvious — that a failed exploration check sets *nothing* rather than
something worse. §11's "Openers" table was open the entire time the descent
scene was being written, and it changed the design: the first draft had a
botched pump-stair setting `fatigued-start`, and the guide's own rule ("the
punishment for creeping badly is the ordinary fight, not a worse one") is what
turned it into a plain branch to the fight instead.

**Encounter scaling.** `minParty`, `minLevel`, `maxLevel` are three fields with
three different meanings and the difference matters at level 6, where a hero who
has played the three shipped one-shots will arrive. Cold Harrow gates a
Carrier-Serjeant behind `minLevel: 5` for exactly that reason. Nothing about
that is guessable from the field names.

**Monster numbers.** §10's one worked line — "a level 4 boss ≈ AC 21, HP 60,
attack +14, DC 21" — is the only anchor, and every one of the fifteen stat
blocks here was written by scaling off it and then checked against a shipped
sibling of the same level. This is the part of the contract that is still prose
and probably always will be: a schema can say `ac` is an integer and cannot say
21 is the right one.

## What the tool caught

Four things, in the order it caught them.

1. **`"schema": "packs/schema.json"` in the pack block.** Added in the first
   draft as a pointer to the contract, in the spirit of `$schema`. The workbench
   reported it as a key nothing reads, which is exactly what it was. Removed. A
   pointer that no loader follows is decoration that looks like configuration.
2. **A scene id collision.** The opening scene was called `arrival`, which is
   also the opening scene of the built-in Bell of Barrowmoor. Harmless — scene
   ids are per-adventure — but it broke the "no id of this pack appears in the
   page" check that proves the phase's own condition, so it became `moor-road`.
   Worth recording because the collision was invisible until something looked
   for it.
3. **An encounter nothing started.** An early draft had a fourth map for a
   branch that got cut, and the map survived the cut. Nothing anywhere pointed
   at it. This is now a validator error, not a workbench note, because it is
   the same class of mistake as an unreachable scene and costs more to write.
4. **A check with one branch.** The audit scene's Diplomacy check had a
   `success` and no `failure` for about ten minutes. The engine sends the other
   half of the rolls to `undefined`, and the player meets "Missing scene",
   which reads as a crash. Also now a validator error.

Two of those four became errors rather than notes, which is the honest summary
of what building the tool was worth: the tool found them, and then the contract
absorbed them, and the next author will never see them.

## What the browser found, and no tool could

One thing, and it was not in the content at all.

Putting Cold Harrow and the bestiary on the Shelf makes four cards instead of
two, which makes the title screen taller than an 800px window. `#screen-title`
is a scrollable flex column with `justify-content: center`, and a scrollable
flex container that centres its children puts the overflow *above* the scroll
origin, where nothing can reach it: the title, New Game and Begin Adventure sat
at y = −47 with `scrollTop` pinned at 0, and the only way to press them was to
make the window taller. `justify-content: safe center` is the whole fix.

Nothing under Node could have seen this. `smoke.mjs` had 1,531 green
assertions with the page in that state. It surfaced because
`npm run games torchbearer` clicks Begin Adventure and Chromium said the node
was not clickable, which is the least helpful phrasing available for "your
layout has an unreachable region". `play-games.mjs` measures the top of the
title screen now, with the whole Shelf loaded, so the next pack to go on the
shelf cannot quietly do it again.

## What the tool found in content that already shipped

Running `unknownFields` over `CORE_PACK` reports six keys. Three are real and
are in the schema now: `effects[].skill` (which `rules.js` folds into
`assurance-<skill>`) and the shield's `hardness` (display only).

The other three are read by nothing at all, and are left out of the schema on
purpose so that the tool keeps reporting them:

* `steel-shield.shieldHP` — Shield Block reduces a flat 5 (`js/combat.js`), not
  the shield's hardness and not its hit points.
* `blazing-bolt.perTarget` — the multi-target path uses `maxTargets` alone.
* `courageous-anthem.composition` — nothing distinguishes a composition cantrip
  from any other cantrip.

None of the three is a bug: they are notes with a data shape, written by
somebody who expected the engine to grow into them. They are worth knowing
about, and they are the reason "unknown fields are silently ignored" is a
promise the engine keeps and the tooling no longer does.

## The one thing that would have made it faster

**The validator returns strings, and the workbench has to guess where they
point.** Every message names the objects it is about — `Adventure "cold-harrow":
scene "the-audit" choice 0 rolls diplomacy and has no "failure" scene` — so the
tool finds a line by pulling the quoted names out of the message and jumping to
the rarest one, on the reasoning that an id occurs twice in a file and a field
name like `text` occurs sixty times. It works, and on a 700-line pack it lands
on the right object essentially every time.

It is still a heuristic over a string that had the answer and threw it away. If
`Validator` returned `{message, path}` instead of a sentence, the workbench
would not need `lineIndex` at all, and the one case where the guess is weakest —
a message whose only quoted token is a field name — would be exact.

Not changed here, and deliberately. The messages are the validator's best
feature: they are written to a person, they say what will break and how to fix
it, and every one of them is asserted verbatim somewhere in a 1,531-check suite.
Restructuring them is a phase of its own, and it should be done by somebody who
wants a machine-readable error rather than by somebody who wants a nicer jump
button.
