# The Absalom Inheritance — Content Authoring Guide

**Audience:** a future session, or a careful human, writing a new area for this engine.

Everything the game knows about the world is in `content/`. The engine has no hardcoded map, no
hardcoded statblock and no hardcoded spell, and since this round it does not hardcode which pack
it plays either: `content/packs.json` is the manifest, and it names two — `vault.json`, the
shipping adventure, and `proving-ground.json`, the smallest thing this engine accepts that is
still a whole adventure (§13). `content/vault.json` is always the authoritative worked example —
when this document and that file disagree, the file is right and this document has a bug.

A pack that fails validation is **rejected whole**, with a message naming the field. Nothing is
partially loaded. That is deliberate: the failure mode this engine is built against is a missing
number reaching a damage roll as `undefined`, which does not crash, does not log, and produces a
creature that silently never hurts anybody. `js/content.js` is the only place that decision gets
made, and `test/smoke.mjs` asserts nineteen separate ways of getting it wrong.

Run `node test/smoke.mjs` after any edit. Run `node test/balance.mjs` too — see §10.

---

## 1. Envelope

```json
{
  "pack": {
    "id": "vault-beneath-the-court",
    "name": "The Vault Beneath the Ascendant Court",
    "version": "1.0.0",
    "schema": 1,
    "description": "One line, for a human reading the file."
  }
}
```

`id` and `schema` are required, and `schema` must be exactly `1`. Bump it only when you change
the shape of the format itself, and then teach `content.js` both shapes.

Any key not described here is ignored, so `note`, `acNote` and `bulkLimitNote` fields are free
real estate for explaining a decision next to the number it produced. There are several in the
shipping pack and they are the best documentation the balance work has.

---

## 2. `tuning`, at the pack and at the room

```json
"tuning": { "visionFeet": 30, "noticeFeet": 30 }
```

| Key | Does |
| --- | --- |
| `visionFeet` | How far the PC sees. Fog of war beyond it; explored squares stay dimly drawn. |
| `noticeFeet` | How close the PC gets before a dormant creature with line of sight wakes. |

**Two keys, and the list is closed.** A third, `standardDC: 15`, sat here from the pack's first
commit and nothing ever read it; the guide's own warning said so and kept it anyway "because the
first skill check will want it". It is gone. The one DC 15 in the engine is the persistent-damage
flat check in `conditions.js`, which is Player Core p.409 rather than a knob a room turns, and
per-area overrides would have turned one dead key into one per area. A pack that writes a key
this table does not list is now **refused at load, with the legal keys in the message** — which
is the thing that stops the next `standardDC` from being written in the first place.

**An area may override either key.** `areas.<id>.tuning` layers on the pack's, key by key, so a
dark room writes the one number it cares about:

```json
"areas": {
  "undercroft": {
    "tuning": { "visionFeet": 20, "noticeFeet": 20 },
    "…": "…"
  }
}
```

`game.js` reads `area.tuning`, never `content.tuning`, and `area` is reassigned by
`transitionTo()` — so the fog shrinks the moment the heir arrives and grows again when she
leaves. The shipping pack's undercroft is the worked example, and its `noticeFeet` is load-bearing
rather than atmosphere: at the vault's 30 ft its sentinel notices a heir crossing the south hall
through the west doorway, and the fight stops being optional. `test/smoke.mjs` asserts exactly
that, square by square.

---

## 3. `pcOptions`

Character creation (round three) turned the single `pc` object into an array of buildable
characters. Each entry is the same character sheet round one and two always had, plus an `id`,
a `blurb` for the picker screen, its own `commands` — which of the pack's global `commands`
(§4) that build can actually use — and, since Phase 7, its own `startingInventory` (§6).

The shipping pack has four: a Wizard, a Fighter, a Cleric and a Rogue. What each of the last two
cost is worth knowing before adding a fifth. The Cleric cost **no engine change at all** — she is
a statline, four command ids, and a satchel. The Rogue cost two: a `debuff` kind and a
`precision` rider, both of which are now content anybody can write. The picker itself has never
been touched: it is built from this array and stacks to one column at 375px whether there are two
cards or four.

```json
"pcOptions": [
  {
    "id": "wizard",
    "name": "Vesper Quill", "title": "Human Wizard 1", "note": "Trained proficiency +3",
    "blurb": "A one-paragraph pitch, shown on the character picker.",
    "hp": 15, "ac": 15, "acNote": "10 + DEX 2 + Trained unarmored +3",
    "speed": 25, "perception": 5,
    "saves": { "fort": 4, "ref": 5, "will": 6 },
    "spellDC": 17, "spellAttack": 7, "slots": 2, "focus": 1,
    "palette": { "top": "#3f6ea8", "left": "#26456b", "right": "#315687" },
    "commands": ["strike", "shield", "splash", "breathe", "fang", "potion"],
    "startingInventory": ["dagger", "potion", "potion", "potion", "book", "rations"]
  },
  {
    "id": "fighter",
    "name": "Kessa Vane", "title": "Human Fighter 1",
    "blurb": "...",
    "hp": 18, "ac": 14, "speed": 25, "perception": 6,
    "saves": { "fort": 6, "ref": 4, "will": 1 },
    "palette": { "top": "#4f8a7a", "left": "#2f5449", "right": "#3d6d60" },
    "commands": ["strike-sword", "potion"]
  }
]
```

**`palette` is required, and it is three colours because the prism has three faces.**
`render.js` extrudes a top diamond and two sides, and there is no colour space in this renderer
to shade one hex into three. Hex `#rrggbb` only, checked at load: a canvas `fillStyle` handed
nonsense silently keeps the value it had, so a typo would draw the last thing drawn's colour and
read as a renderer bug rather than as a content one.

There is no default on purpose. A default is how two builds come to look identical, which is
exactly what happened — the wizard and the fighter drew the same blue prism for two whole rounds
and nothing in the game or the tests said so. Pick against the board, not for the character: the
foes are red (`#8a3a46`) and the Keeper is purple (`#6f4a8a`), so a warm PC reads as one of them
at a glance. The picker draws the same three faces as a swatch on the card, off the same field,
so the card and the board cannot disagree.

`id` and a unique one across the array, `hp`, `ac` and all three `saves` are required per build.
`slots` and `focus` default to 0 — a build with no spellcasting simply omits them, the way the
fighter above does — and set both the starting count and the maximum, and the number of gems
drawn in the left panel once that build is chosen; the sheet is built from the chosen build, so it
cannot drift from the rules the engine is applying.

`perception` is the initiative modifier.

`commands` is a list of ids from the pack's own `commands` array (§4) — not a separate command
definition. Two builds can point at the same command (both list `"potion"`, say) or at entries
that exist only for one build (only the fighter lists `"strike-sword"`); either way, the id has to
resolve against something in `commands`, or the pack is refused at load. Omit `commands` entirely
and a build gets every command in the pack, which is what kept the one-build era's packs (and any
test fixture that never bothered to add the field) working unchanged.

**`content.pc` is a convenience default — `pcOptions[0]`** — for a caller that has not chosen a
build yet. Real play never reads it: `js/content.js` exports `selectPc(content, buildId)`, which
resolves one build's stats onto `content.pc` and narrows `content.commands`/`commandById` down to
exactly that build's list. Every other module (`game.js`, `save.js`, `render.js`, `ui.js`,
`test/autopilot.mjs`) reads `content.pc`/`content.commands` exactly as if there had only ever been
one PC, and none of them changed for character creation — `main.js` calls `selectPc` once, right
after the player picks (or right after a save names which build it was), and everything downstream
of that is unaware a choice was ever made. **`pcOptions[0]` has to stay the wizard.** A save
written before this feature existed has no `buildId` field at all, and `save.js`'s `repair` falls
back to `pcOptions[0]` for exactly that save — reordering the array changes what an old save
becomes.

**The autopilot that drives `balance.mjs` reads a build's commands by *kind*, not by id** —
`findUsable(game, "attack")` rather than a hardcoded `"strike"`. A pack that adds a third build
does not need to touch `test/autopilot.mjs` at all, provided the new build's commands use `kind`
honestly (an attack command really is `"attack"`, a heal really spends `healing`, and so on).
`test/balance.mjs` runs and reports each build in `pcOptions` separately and fails the build if
any one of them is out of band — a build with an unfair shot at the vault is exactly as much a
shipped bug as the original single build being unwinnable was.

---

## 4. `commands`

An array, in the order they appear in the panel. The number key that fires a command is its
position in this array, so reordering changes the hotkeys.

Every command needs `id`, `name`, `cost` (1–3, or 0 for a `reaction`) and `kind`. `flavour`
renders in parentheses, `costGlyph` defaults to that many `◆` (`↺` for a reaction), `hint` is
shown when the command is armed, and `note` is the button's tooltip.

| `kind` | Needs | Does |
| --- | --- | --- |
| `attack` | `attackBonus`, `damage` | Attack roll vs the target's AC. Target must be adjacent. Crits double. |
| `cone` | `coneFeet`, `damage`, `save`, `spell` | A quarter circle from the heir toward the square you clicked. Everything in it rolls a basic save vs her spell DC. |
| `burst` | `rangeFeet`, `burstFeet`, `damage`, `save`, `spell` | The same, around a square you place within `rangeFeet` and have line of effect to. |
| `emanation` | `emanationFeet`, `damage`, `save`, `spell` | The same, around the heir. Takes no target. |
| `unerring` | `rangeFeet`, `damage` | No roll, no save. Needs line of effect. |
| `buff` | `applies` | Puts one *helpful* condition on the heir. Takes no target. |
| `debuff` | `rangeFeet`, `save`, `inflicts`, and `spell` or `dc` | Targets a creature. One save; a failure leaves a condition behind. Rolls no damage at all. |
| `self-heal` | `healing` | Heals the PC. |
| `consume` | `healing`, `consumes` | Heals, and destroys one matching item. The only kind usable outside an encounter. |
| `reaction` | `triggers`, `effect` | Fires by itself at one of three named points. Costs 0. See below. |

Costs and resources:

* `spendSlot: true` — consumes a spell slot; the command is unavailable at zero.
* `spendFocus: true` — consumes the focus point.
* `consumes: "<item id>"` — unavailable when no such item is in the satchel.
* `agile: true` — on an `attack`, uses the agile MAP of −4/−8 instead of −5/−10. The shipping
  dagger is agile and the original build was not modelling it.
* `ability: "str" | "dex"` — which ability rolls this attack. Defaults to `str`, so no pack that
  predates the field had to change; the shipping dagger is finesse and says `dex`. It decides
  which of `enfeebled` (Strength) and `clumsy` (Dexterity) can touch the roll, and getting it
  wrong is silent.
* `spell: true` — this command is Casting a Spell. It is what the `stupefied` flat check keys
  off, and nothing else reads it. A cantrip is a spell; a potion is not.

`damage` and `healing` are stat-block strings: `"1d6"`, `"2d6"`, `"1d4+1"`, `"1d8-1"`. A string
this engine cannot parse **throws at load**. That is the point; `"1d6+"` used to be a sentinel
that hit for nothing.

`save` is `"fort"`, `"ref"` or `"will"` and is read off the target creature's `saves`. Anything
else **throws at load** rather than rolling against `undefined`.

### The three area kinds

`cone`, `burst` and `emanation` all resolve the same way: `js/templates.js` works out the squares,
`world.reachableFrom` cuts them to what the room lets through, and everything standing in what is
left rolls one basic save against one DC, read once. They differ only in where the shape starts.

* **`cone`** starts at whoever is casting it and points at the square that was clicked (or, for a
  creature, at the heir). The aim snaps to one of the eight grid directions, so a cone is a quarter
  circle on the grid rather than a wedge that rotates with the pointer. The caster's own square is
  never in it.
* **`burst`** is placed. `rangeFeet` is how far the centre can be from her and `burstFeet` is the
  radius; the centre needs line of effect, and a placement that fails either is refused without
  spending anything.
* **`emanation`** is centred on her and takes no target at all — it fires straight from the command
  list, the way `buff` does, with nothing to click.

Three things to know before writing one:

* **An area command carries either `spell: true` or its own `dc`, and never both.** A spell's save
  rolls against the heir's spell DC, and `stupefied` moves it; a command with a `dc` writes its own
  number down, which is what a creature's ability does, because a construct has no spell DC to
  borrow. A command with neither would borrow one it has no claim to and a command with both would
  have two and no rule saying which; **both throw at load**. (This was "must be a spell" until
  creature abilities existed — #157 amends #152.)
* **The engine measures square centres**, where the book measures a burst from a corner and an
  emanation from the edge of your space. Knowing departure; see the README's "Areas".
* **A 10-foot emanation and a 10-foot burst on the same square are the same set of squares**, because
  every actor in this engine stands in one square. The difference is who picks the centre.

**Line of effect is not line of sight.** `blocksSight` does not read the gate — it is a portcullis —
and `blocksEffect` does. Every template and every `unerring` command filters through `hasLoE`, so a
square you can see through the bars is one you cannot cast into, and a pillar throws a shadow across
a cone rather than sitting inside one.

**A command nothing casts fails the build.** `test/balance.mjs` counts, per build, how many times
the autopilot cast each non-reaction command across the whole batch, and exits non-zero if any of
them reads zero. Write a command the adventure has no room for and the number says so. This is not
hypothetical: Phase 2 shipped a spell that had never been cast in any figure this project quoted,
and Phase 3 added two more and reached neither on its first run. **The same check counts creature
abilities**, which cannot appear in that list because no build lists them — an ability named by any
creature in the pack and never used across the batch fails the run the same way.

### `buff` and `debuff`: a command whose effect is a condition, not a number

These two are the kinds with no damage roll in them, and they are the ones to reach for when a
build's identity is what it does to a fight rather than how hard it hits.

**`buff`** takes an `applies` block and nothing else:

```json
{
  "id": "litany", "name": "Warding Litany", "cost": 1, "kind": "buff", "spell": true,
  "applies": { "condition": "warded", "value": 1 },
  "hint": "Warding Litany (◆): +1 AC and +1 to every save until your next turn begins."
}
```

The condition has to be one the catalogue calls **helpful** — today that is `shielded` and
`warded` — and a `buff` that applies `clumsy` **throws at load**. `value` defaults to 1 and is
what the condition is worth per point, so a pack that writes `"value": 2` on `shielded` gets a
+2 disc with no code change. **The duration is the catalogue's, not yours.** "Until the start of
your next turn" is part of what the disc *is*; a pack that had to restate it would ship one that
forgot and leave a bonus stapled to the heir for the rest of the delve.

Only a `buff` may write `applies`. Anything else that does **throws at load**, because a
self-heal that quietly shielded you is a rule no player could find.

**`debuff`** is the mirror, aimed outward:

```json
{
  "id": "shim", "name": "Shim the Joint", "cost": 1, "kind": "debuff",
  "rangeFeet": 5, "dc": 17, "save": "ref",
  "inflicts": { "condition": "off-guard", "value": 1, "on": "fail" }
}
```

It targets one creature within `rangeFeet` that it has line of effect to, rolls that creature's
`save` against one DC, and hands the degree to `inflicts`. It reads its DC by exactly the rule
the area kinds do: `spell: true` to roll against the heir's spell DC, or its own `dc`, never
both and never neither. A dormant creature targeted by one wakes up. Four things **throw at
load**: a `damage` field (a debuff's whole effect is the condition — a command that does both is
an `attack` or an area with a rider), a missing `rangeFeet`, `save` or `inflicts`, an `inflicts`
naming a condition the catalogue calls helpful, and the DC rule above.

`on: "fail"` is the entry that exists for this kind, and it means failure *or worse* — see the
next section.

### Precision damage: a second die, gated on a state

An `attack` may carry a `precision` block, which is PF2e's Sneak Attack written as content:

```json
"precision": { "damage": "1d6", "when": "off-guard" }
```

The extra die is rolled only when the target already has the named condition, and a critical hit
doubles it along with the rest of the damage. `when` names a condition rather than meaning
off-guard by definition, because "off-guard" is the state PF2e happens to gate precision on and a
pack that wants a blade that bites the frightened should not need a code change. It must be a
condition the catalogue does *not* call helpful — nothing in this engine puts a helpful condition
on a foe, so a rider gated on one would never fire — and only `attack` may carry it. Both
**throw at load**.

`enfeebled` takes its point off the weapon's damage roll and not off the precision die: PF2e's
penalty is to *the* melee damage roll, once. That is why `damageFrom` has a `precision` source of
its own.

### Conditions a command leaves behind, and takes off

`inflicts` hangs a condition off a roll that already happened. One object, or an array of them
when a single swing leaves two things behind — the Vault Keeper's critical fist is `frightened`
and `stupefied` together. Two entries naming the same condition are a load error, because the
bag's higher-value-wins merge would silently drop one of them.

```json
"inflicts": [
  { "condition": "frightened", "value": 1, "on": "crit" },
  { "condition": "stupefied",  "value": 1, "on": "crit" }
]
```

`condition` must be one the catalogue in `js/conditions.js` defines — `shielded`, `warded`,
`frightened`, `off-guard`, `clumsy`, `enfeebled`, `stupefied`, `slowed`, `persistent-fire` — and
an unknown one throws at load, for the same reason an unknown tile name does. `value` defaults to
1 and must be a positive integer. `on` is one of exactly four:

| `on` | fires when | reads whose roll |
| --- | --- | --- |
| `hit` | the attack succeeded or better | the attacker's |
| `crit` | the attack critically succeeded | the attacker's |
| `fail` | the target failed **or worse** | **the target's** |
| `crit-fail` | the target critically failed | **the target's** — which is what a basic save wants |

`fail` is failure or worse on purpose, the mirror of what `hit` means on the other side: a rider
that stopped applying because the save went from bad to worse is the one bug in this funnel
nobody would go looking for. It exists because a `debuff` is a command with nothing in it but the
condition, and one that only fired on a critical failure would be a build built on a one-in-five.
A basic-save area is usually still better written with `crit-fail` — Breathe Fire setting a
critical failure alight is the spell's own rider, not its whole effect.

An `unerring` command rolls nothing, so it has no degree: it counts as a `hit`, always. Force Fang
is the pack's one source of `slowed` for that reason — slowed is worth a whole focus point, and an
attack roll would make it a coin flip.

**You do not write the duration.** It comes off the catalogue: `off-guard` lasts until the start
of the afflicted actor's next turn, `clumsy`, `enfeebled`, `stupefied` and `slowed` until the end
of it, `frightened` decays by 1 at the end of each of the afflicted actor's turns, and
`persistent-fire` ends on its own flat check or not at all. A pack that had to remember to write
one would ship one that forgot, and a forgotten duration is a −2 stapled to the heir for the rest
of the delve.

`ends` is the other direction: a command that takes a condition off.

```json
"ends": { "condition": "persistent-fire", "flatDC": 10 }
```

With a `flatDC` it rolls that flat check and ends the condition on a success — which is Player
Core p.409's "a particularly appropriate action lowers the check", and is why Rousing Splash
rolls DC 10 where the fire's own check is DC 15. Without one it ends the condition outright.
Only the PC's own bag is touched. `flatDC` outside 2–20 throws.

### Reactions

A reaction is not a button. There is no way for a player to spend one by hand — `useCommand`
refuses a `reaction` with `reaction-only` — and no way for content to make it cost an action.
It fires from the trigger bus in `game.js` at one of exactly three named points, or it does not
fire. One reaction per actor per round, refreshed at the top of that actor's own turn.

```json
{
  "id": "reactive-strike", "name": "Reactive Strike", "flavour": "reaction",
  "cost": 0, "costGlyph": "↺",
  "kind": "reaction", "effect": "strike", "triggers": ["move-out-of-reach"],
  "attackBonus": 7, "damage": "1d8+2", "damageType": "slashing"
}
```

`triggers` is a non-empty array drawn from this list, and nothing else. A fourth name is a load
error rather than a reaction that sits in the pack looking correct and never fires:

| trigger | fires | `ctx` carries |
| --- | --- | --- |
| `incoming-attack` | before a Strike is rolled, from either side of the board | `actor`, `target` |
| `move-out-of-reach` | when somebody steps out of a square within the reactor's reach | `actor`, `from`, `to` |
| `incoming-damage` | when damage is resolved and about to land | `actor`, `target`, `dmg`, `dtype` |

`effect` is `strike` or `reduce`, and nothing else.

* **`strike`** needs `attackBonus` and `damage`. It Strikes whoever set the trigger off, at no
  multiple-attack penalty, and adds none — the swing happens on somebody else's turn, and MAP
  belongs to your own. **A creature using a `strike` reaction Strikes with its own stat block's
  `attackBonus` and `damage`, not the command's:** a basalt fist is not a longsword whichever
  feat swings it. The command's numbers are the PC's.
* **`reduce`** needs a positive `hardness`, and takes an optional `damageTypes` array that
  narrows what it works against (absent means everything). It subtracts from `ctx.dmg` before a
  single hit point moves. It only ever protects its own owner.

`requiresShield: true` on a `reduce` reaction means it needs the Shield cantrip up — the engine's
only shield — and that using it ends the cantrip, which is what Player Core says about the force
disc. Only the PC can have one.

**Reach.** `reachFeet` on a build or a creature is how far it threatens, and it drives the
`move-out-of-reach` test on both halves: the mover must have been inside it and must have left
it. It defaults to 5. A reach weapon would say 10 and nothing else would need to change.

**A caution about the shipped creature AI.** A creature Strides to the *cheapest* open square
beside the PC, and an optimal path to the cheapest such square cannot cross another one on the
way — so a creature enters your reach and never leaves it. A `move-out-of-reach` reaction on a
*build* therefore fires only when the engine grows a creature that retreats or repositions.
Given to a *creature*, it fires today, against a player who walks away. `smoke.mjs` asserts the
zero over 3,032 planned Strides and will say so when that changes.

---

## 5. `creatures`

Keyed by id.

```json
"shattered-sentinel": {
  "name": "Shattered Sentinel", "level": -1,
  "hp": 11, "ac": 13, "perception": 2, "speed": 20, "reachFeet": 5,
  "saves": { "fort": 5, "ref": 1, "will": 0 },
  "attackBonus": 4, "attackName": "Fist", "damage": "1d6", "damageType": "bludgeoning",
  "ability": "str",
  "immunities": ["mental"],
  "inflicts": { "condition": "off-guard", "value": 1, "on": "crit" },
  "reactions": [],
  "abilities": [],
  "ai": "brawler",
  "deathLine": "{name} shatters into gravel and gold dust.",
  "wakeLine": "Rubble shudders upright into a humanoid shape — {name} still keeps its post.",
  "sleepLine": "{name} loses you in the dark. The rubble settles, and reknits."
}
```

`hp`, `ac`, `saves` and `damage` are required. `{name}` in any of the three lines is replaced.

`level` is informational except that the renderer draws anything at level 0 or above taller and
in the boss palette. Use it honestly anyway — it is how a later session works out what the
encounter budget was supposed to be.

`speed` defaults to 25 rather than throwing, but it is never allowed to be `undefined`: a
creature with no Speed paths zero feet and stands still forever, which is the same class of bug
as The Fourth Quarter's staffer whose missing walking speed became a NaN (site session 7,
§2). The smoke suite asserts the fallback is a usable number.

`immunities` is a closed list — today only `"mental"` — and it refuses conditions carrying that
trait, out loud, in the log. Every creature in the shipping pack is a construct and PF2e
constructs are immune to mental effects, so nothing in this vault can be frightened. An unknown
trait throws at load.

`ability` works exactly as it does on a command and defaults to `"str"`, so a creature that says
nothing swings with Strength. `inflicts` works exactly as it does on a command, and hangs off the
creature's own Strike.

`reachFeet` defaults to 5 and is how far this creature threatens for `move-out-of-reach`.
`reactions` is an array of command ids, each of which must exist in the pack's `commands` and
be `kind: "reaction"` — the lookup is against the whole pack rather than the chosen build's
slice, because a creature's feats have nothing to do with which heir walked in. The Vault Keeper
ships with `["reactive-strike"]`, which is what makes walking away from it a decision.

### Creature AI

`ai` is one of three, and absent means `"brawler"` — the behaviour every creature had before this
field existed, so an older pack needs no edit.

| `ai` | the turn it takes |
| --- | --- |
| `"brawler"` | Stride toward the nearest open square beside the PC, Strike when adjacent, three actions a turn, MAP applied. |
| `"skirmisher"` | Strike once, then leave her reach and stay out of it for the rest of the turn: a Stride when that provokes nothing, a Step when it would, and neither when it is cornered against a foe holding a reaction. |
| `"caster"` | Open with an ability whose shape catches the PC and none of its own, then behave like a brawler with what is left. |

The decision itself is `js/ai.js`'s `chooseAction(view)`, which is pure: it ranks measurements
`game.js` has already made and hands back one option, and the turn walks that option rather than
re-planning. If you want something the three do not do — shooting, focusing a wounded target,
calling for help, holding an ability for a better turn — that is a new policy in `ai.js` plus a
name in `AI_KINDS`, not a new field here.

`abilities` is an array of command ids this creature can put on the board, **once each per
encounter**, and the rules for one are stricter than for a reaction:

- it must be an area kind (`cone`, `burst` or `emanation`) — a creature's turn has no slots, no
  focus pool and no inventory, so any other kind would validate here and be unreachable there;
- it must carry its own `dc`, because a construct has no spell DC to borrow and the heir's moves
  when she is stupefied;
- the lookup is against the pack's whole `commands` list, like `reactions`, so the command can be
  one no build lists. `gravel-wave` is exactly that: it is in `commands` and in nobody's
  `commands` array, so no heir can cast it.

An `ai: "caster"` with an empty `abilities` is refused at load. A `brawler` holding an ability is
allowed and simply never uses it — which `balance.mjs` will then fail on, because an ability no
creature ever fires is content nothing reaches (#162).

The spend is runtime-only, beside the reaction budget, and never reaches the save: it belongs to
one encounter, and a reload re-rolls initiative rather than resuming the round it was in.

---

## 6. `items`, `startingInventory`, Bulk

```json
"items": [ { "id": "dagger", "name": "Dagger", "glyph": "🗡", "bulk": "L" } ],
"startingInventory": ["dagger", "potion", "potion", "potion"],
"inventorySlots": 8,
"bulkLimit": 5
```

`bulk` is a number or the string `"L"` for Light. Ten Light items make one Bulk (Player Core
p.271); the readout shows tenths so it moves when you pick something up, and encumbrance uses
the whole number.

`startingInventory` may repeat an id — that is how the PC carries three potions. Naming an item
that is not in `items` is a load error.

**A build may carry its own satchel.** Put a `startingInventory` on a `pcOptions` entry and it
replaces the pack's for that build; a build that names none gets the pack's, which is what keeps
every pack written before this working unchanged. It is a replacement and not a merge, so a
build that names one lists everything it carries.

```json
"pcOptions": [
  { "id": "fighter", "...": "...", "startingInventory": ["longsword", "potion", "potion", "potion", "rations"] }
]
```

This was pack-level for two rounds, and the cost of that was on the board the whole time: the
Fighter walked four rooms carrying the Wizard's spellbook and a longsword sat in the Wizard's bag
that she has no proficiency with. Two builds were happy sharing a satchel; four are not.

There are two places the satchel is resolved and both of them matter. `selectPc` resolves it for
anything that builds a run from content — `game.js`, `balance.mjs` — and `save.js`'s `freshRun`
resolves it again, because `main.js` picks a build, calls `freshRun` with the *unresolved* pack,
and only then runs `selectPc` on the state it gets back. A unit test that only exercised the
first one went green for an afternoon while every build in the browser opened its bag on the same
longsword and spellbook.

Nothing is equippable. `dagger` and `longsword` are flavour; the Strike command carries its own
`attackBonus` and `damage`. If a future area wants a weapon that changes the numbers, that is a
command-per-weapon or an equip system, and both are engine work.

---

## 7. `lore` and pillars

```json
"lore": {
  "bequest": {
    "title": "The Western Pillar — The Bequest",
    "body": ["First paragraph.", "Second paragraph."],
    "logLine": "You study the western pillar."
  }
}
```

`body` is an array of paragraphs and is **escaped, not rendered as HTML** — write plain text.
The original build interpolated raw HTML into the modal; there is no reason for content to have
that power.

A pillar is a map square whose legend entry names a lore id (§8). Reading one is an Interact at
5 ft. Each can be read once.

**A pillar may also hand something back.** Three optional keys, and they are the *same three* the
gate has always carried, read by the same `applyRestore` in `game.js`:

```json
"mason-mark": {
  "title": "The Mason's Mark",
  "body": ["…"],
  "logLine": "…",
  "restore": ["hp", "slots", "focus"],
  "restoreHp": 8,
  "restoreNarrative": "You drink, and sit as long as the basin takes to still."
}
```

`restore` is a closed list — `hp`, `slots`, `focus` — and a name outside it is refused rather than
ignored, because before that check existed `restore: ["spells"]` loaded and did nothing.
`restoreHp` caps the heal; omit it for a full one, which is what the gate does. `restoreNarrative`
only prints when something actually moved, so a heir who reads the pillar at full health does not
get told she was healed.

**This is the whole mechanism a pack has for rewarding an optional fight**, and it is deliberately
not a new tile kind. A tile that yields an item would cost `render.js` a colour and `ui.js` a
sentence, and a room would stop being a content file — which is the one property §12 exists to
protect (locked decision #175).

---

## 8. `areas`, `startArea`, `areaOrder`

The pack can hold more than one area now — round two's actual change, not a plan for one. `area`
(singular) no longer exists; `areas` is an object keyed by area id, `startArea` names the one the
PC begins in, and `areaOrder` (optional; defaults to the object's own key order) is the sequence
a session or a test walking the whole adventure should expect to visit them in.

```json
"startArea": "vault",
"areaOrder": ["vault", "undercroft", "sanctum"],
"areas": {
  "vault": {
    "name": "The Vault Beneath the Ascendant Court",
    "legend": {
      "#": { "tile": "wall" },
      ".": { "tile": "floor" },
      "G": { "tile": "gate" },
      "V": { "tile": "stairs", "to": { "area": "sanctum", "x": 6, "y": 8 } },
      "P": { "tile": "pillar", "lore": "bequest" },
      "@": { "tile": "floor", "spawn": "pc" },
      "e": { "tile": "floor", "creature": "shattered-sentinel" },
      "k": { "tile": "floor", "creature": "vault-keeper", "wakesOn": "gate-opened" }
    },
    "rows": ["######", "#.@..#", "######"]
  },
  "sanctum": {
    "name": "The Reliquary",
    "hint": "The reliquary. The casket is behind the warden.",
    "legend": { "#": { "tile": "wall" }, ".": { "tile": "floor" }, "T": { "tile": "treasure" } },
    "rows": ["######", "#....#", "######"]
  }
}
```

`tile` is `floor`, `wall`, `gate`, `pillar`, `treasure` or `stairs`. Walls and pillars block
movement, sight and effect; a gate blocks movement and effect until it opens and never blocks
sight (it is a portcullis); treasure and stairs are walkable and transparent to all three — a
stairway is a floor tile with a destination attached, nothing more.

**Those six live in one table**, `TILE_KINDS` at the top of `js/world.js`, and it is the only
place any of it is written down: `world.js`'s three barrier predicates read it, `content.js`'s
legend parser reads it to turn a name into a tile, and `save.js`'s `repair` reads it to decide
where a body may stand. There used to be three lists, and a kind added to one and missed in
another was a pack that either refused to load or loaded with a hole in a wall.

Adding a seventh kind is one row, appended (the id is the index, and `render.js` and `ui.js`
switch on `TILE.WALL` and friends, so reordering repaints the board). Each row declares
`blocksMove`, `blocksSight` and `blocksEffect`, and **all three default to `true`** — you opt out
of solidity, never into it. That direction is the point: a kind whose author forgot to say what it
blocks becomes a square nobody can walk into, which is visible in the first ten seconds of play;
the other default is a wall you walk through, which reads as a rendering bug and gets found much
later. `"unless-open"` is the one conditional answer and it is the gate's.

Note what the registry does **not** buy you: a new kind is still a code change, one row in
`world.js` plus whatever colour `render.js` gives it and whatever sentence `ui.js` announces for
it. A new *area* is a content change. Those are different claims and §12 is about the second one.

A legend entry may also carry:

* `spawn: "pc"` — where the PC starts. Required in the **start area only** — `content.startArea`
  names it, and that is the only area a fresh run ever needs to spawn into. An area reached
  purely by stairs (the sanctum, today) has no spawn and does not need one; its `pcSpawn` loads as
  `null`.
* `lore: "<lore id>"` — makes a `pillar` readable.
* `creature: "<creature id>"` — places one. Repeat the character to place several of the same
  kind; each gets its own identity from its coordinates and its area (two areas may reuse the
  same creature id at the same local coordinates without colliding — see below).
* `wakesOn: "notice"` (default) or `"gate-opened"` — `gate-opened` keeps a creature dormant no
  matter how close you get, until the gate opens.
* `to: { "area": "<area id>", "x": <int>, "y": <int> }` — required on a `stairs` tile. Names the
  destination area and the exact square the PC arrives on there. The destination area does not
  need to exist earlier in the file — validated in a pass after every area is parsed, so a
  stairway is free to point forward.

An area may also carry a **`tuning`** block (§2), overriding the pack's `visionFeet` and
`noticeFeet` for that room alone.

An area may also carry a **`hint`**: the line the hint bar shows on arrival. A stairway swaps the
whole board out from under it, and without one the bar goes on describing the room you left.
**It is required on any area a stairway leads into**, checked against the stairways rather than
against every area — the start area needs none, because `intro.hint` is the line for the room you
have not left yet, and the vault (which nothing points at) deliberately has none. That rule is
what keeps `transitionTo` from needing a fallback branch nothing can reach. A save reopened in
an area shows that area's hint too, falling back to `intro.hint` for the start area.

Rules the loader enforces, per area: every row the same length, every character in the legend,
every `lore` and `creature` reference resolvable, at least one creature, a `pc` spawn if (and only
if) this is the start area. Across areas: `startArea` must name a real one, `areaOrder` may only
list real ones, and every `stairs` destination must name a real area, land inside its bounds, and
lead to an area that has a `hint`.

**A creature's saved identity includes its area.** The key game.js and save.js both use is
`"<areaId>:<creatureId>@<x>,<y>"`, not just `"<creatureId>@<x>,<y>"` — the area has to be in it or
two areas placing the same creature id at the same local coordinates would collide. A round-one
save predates this and has no area prefix; `save.js`'s `repair` recognises a colon-less legacy key
and rewrites it onto the real placement rather than spawning a duplicate. If you are reading this
because you are about to touch that migration: it only works because a creature's key has never
been anything but its *original placement* coordinates, even after it moves — do not "fix" the key
to track current position, or the migration (and the underlying identity scheme) breaks.

**Every creature in every area exists in a fresh run's state from the start**, not just the one
the PC is standing in — a construct in a room whose door is not open yet still has to be there,
dormant, the moment a save from that far along gets built. `living()` and `awake()` are scoped to
`run.areaId`: a creature belongs to the room its body is in, whatever else has state.

**Fog of war is one bitfield per area, not one for the whole pack.** `run.fog` is an object keyed
by area id; `game.js` banks the current area's bitfield under its own id the instant a stairway
fires and loads the destination's (or an empty one, on a first visit) in its place. A round-one
save's single `explored` string migrates into this shape under its own `areaId` in `repair`.

**Author the map as text and read it.** The board being legible in the file is why the two
sentinels' positions were easy to reason about, and why moving the Keeper from row 3 to row 1 —
a one-character edit — was a balance change worth measuring.

---

## 9. `gate`, `treasure`, `defeat`, `intro`

```json
"gate": {
  "requiresLore": ["bequest", "condition"],
  "sealedHint": "…", "sealedLog": "…",
  "openNarrative": "…", "openHint": "…",
  "restore": ["slots", "focus", "hp"],
  "restoreHp": 8,
  "restoreNarrative": "…"
},
"treasure": {
  "requiresDown": ["vault-keeper", "reliquary-warden"],
  "blockedHint": "…",
  "title": "…", "body": ["…"]
},
"defeat": { "title": "…", "body": ["…"] },
"intro":  { "narrative": "…", "goal": "…", "hint": "…" }
```

`gate.requiresLore` lists the lore ids that must be read. When the last one is read the gate
opens, anything with `wakesOn: "gate-opened"` starts noticing, and whatever `restore` names is
refilled: `"slots"`, `"focus"`, `"hp"`. `restoreHp` caps the healing; omit it for a full heal.

**`restore` is the whole reason the adventure has two acts.** A solo level-1 wizard's entire day
is two spell slots and one focus point. Without a rest between the sentinels and the boss the
delve is three encounters on one wizard's resources, which measured at 10.7% winnable. Read the
`restoreNote` in the shipping pack before you take it out.

`treasure.requiresDown` lists creatures that must be dead before standing on a treasure square
wins — one entry per boss in the way, whichever area each stands in. `requiresDown` is checked
against `run.creatures` as a whole, not the current area, precisely so a boss in an earlier area
(the Keeper) can still gate a casket in a later one (the sanctum) without either of them knowing
about the other.

`intro.narrative` and `intro.goal` are the first two log entries of a new run. `intro.hint` is
the opening hint line.

---

## 10. Test your numbers, do not reason about them

`node test/balance.mjs [runs]` plays the adventure end to end with a seeded RNG and an autopilot
that fights everything, and reports the win rate. `--verbose` prints the first twelve runs.

It exits non-zero outside the band declared in `balance.mjs` (currently 45–90%), so a content
edit that makes the adventure unwinnable fails the build.

**The band is 45 points wide, so it is not the only check.** A batch also reports one row per
encounter — keyed by the area and the creature that started it — and one per area, and it
compares both against `test/baseline.json`, the numbers the last commit measured. A change past
`DRIFT` fails and names the fight it moved:

```
BASELINE DRIFT — fighter: win rate 75.1% → 64.7% (−10.4 points, tolerance 3.0)
                 fighter, vault/vault-keeper: killed 20.9% of runs, now 31.3% (+10.3 points, tolerance 3.0)
```

**This is the check most likely to fail on a change you meant.** Retuning a stat block is exactly
what it fires on. When the drift is the change you intended, rerun with `--write-baseline` and
commit `test/baseline.json` in the same commit, with the new figures in your notes. The
comparison is exact rather than statistical — every run uses the seed `0x5EED + i`, so the same
pack over the same run count gives the same numbers on every machine — and it only runs when the
run count matches the baseline's (2000, which is what CI uses).

**Two numbers per encounter, not one, and the second is the one that matters.** Damage taken per
fight truncates: a fight that kills you stops dealing damage, so the harder an encounter gets the
less of it the average shows. Bumping the Keeper's fist by two points cost the fighter 10.4
points of win rate and moved her damage-taken by 1.8, inside its own tolerance. Deaths per
encounter is what did not truncate.

**`--variant name={json}` measures a cause rather than an effect.** It patches the pack (RFC 7386
merge patch, so `null` deletes a key and an array replaces one whole), loads it through the same
`loadPack` a real pack goes through, and prints the columns side by side — win rate, rounds,
damage, and the share of runs that died in each encounter. It is repeatable, so three columns is
three flags:

```
node test/balance.mjs 2000 \
  --variant 'brawler-keeper={"creatures":{"vault-keeper":{"ai":"brawler","abilities":null}}}' \
  --variant 'no-skirmish={"creatures":{"reliquary-warden":{"ai":"brawler"}}}'
```

A patch that makes the pack invalid is refused there exactly as a bad edit to `vault.json` would
be, rather than producing a column of quietly wrong numbers.

This is not a nicety. The single-file build this replaced could not be finished on any seed —
two Creature-0 constructs woke together and put six attacks a round into a 15 HP wizard — and
the only reason anybody found out is that something counted. Three separate content changes
during this session moved the win rate 10.7% → 29.6% → 40.8% → 59.3%, and two of the four were
not what a reading of the stat blocks would have predicted. One was not a balance change at all:
the harness turned up a bug where killing the boss while standing on the casket never triggered
the win, which was costing a third of all runs.

**Round two added a fourth mandatory fight (the sanctum's reliquary warden, §11) and it moved the
win rate again: 59.3% → 53.6%.** Measured both ways — the warden at full sentinel strength landed
41.5%, just under the 45% floor, which is why it shipped weaker (§5's note on that creature has the
exact numbers). The harness caught a second bug this round that was not a balance problem either:
a Stride landing exactly on a stairway mid-combat never rechecked the stairs once the fight ended,
which read in `balance.mjs` as a wall of `"unfinished"` runs at full HP — not a low win rate, a
stall. §11 has the fix. Same lesson as round one's casket bug, applied to a different standing
condition: count first, and a `playThrough()` that stalls is telling you something a win-rate
number alone would hide.

Numbers a reasonable pack should hit:

| Reading | Healthy |
| --- | --- |
| win rate | 45–90%, and say the real figure in your notes |
| reached the last objective | above ~80%, or the first act is doing the killing |
| on a win: HP left | comfortably above zero, or wins are coin flips |
| encounter rounds, median | single digits to low teens |

If the win rate is out of band, prefer changing **how many encounters there are between rests**
over changing a stat block. That was the binding constraint every time here, and it is the one
that stat-block arithmetic hides.

---

## 11. A second area, worked: the sanctum

Round two shipped this. `areas` is real (§8), `stairs` is a real tile kind, and the shipping pack
uses both: past the gate, where the Keeper used to stand directly over the casket, two `V` squares
now lead to `sanctum` — a small room with its own guardian (`reliquary-warden`, deliberately weaker
than a sentinel — see its `note`) and the casket the Keeper used to guard directly. Read
`vault.json`'s `areas.sanctum` alongside this section; it is the worked example, and if the two
disagree the file is right.

**What actually changed, for a session adding a third area on top of this one:**

1. `content.js` parses `areas` (plural, keyed by id) instead of a single `area`, plus `startArea`
   and `areaOrder`. A `stairs` legend tile needs a `to: {area, x, y}`, validated in a pass after
   every area is parsed (so a stairway may point at an area declared later in the file).
2. `game.js` keeps `area` and `world` as `let`, not `const` — `transitionTo()` reassigns both when
   the PC steps onto a stairway, and every function in the module reads them fresh through the
   closure rather than a value captured once at boot. Both are exposed to callers as *getters*
   (`get area()`, `get world()`), not plain fields, for the same reason: a plain field copied out
   once at construction would go stale the instant a transition happened.
3. `run.creatures` holds every creature from every area from the start of a fresh run (see §8),
   each tagged with its own `area`; `living()`/`awake()` filter to `run.areaId`. `run.fog` is a map
   of area id to bitfield, not a single string.
4. `save.js`'s `repair` resolves `s.areaId` first (falling back to `startArea` if the pack no
   longer defines it), then clamps the PC and every creature against *its own* area rather than a
   single shared one, and migrates a round-one save's key format and single `explored` string into
   the new shapes (§8 has the details — read them before touching either migration).
5. `render.js` and `ui.js` read the current area through `game.area` on every frame or call, not a
   value destructured once when the module was set up. `render.js` additionally has to force a
   full `syncSize()` recompute on a transition even when the canvas's own CSS box has not changed
   size, since two areas can differ in grid dimensions without the browser window moving at all.
6. **The single easiest way to get this wrong**: `checkTreasure()` was already a "standing
   condition, not an event" (§10's whole reason for existing) — checked on every step, on a
   creature's death, and when an encounter ends, because a Stride mid-combat can land the PC on
   the treasure square with nothing left to re-trigger it. `checkStairs()` needs exactly the same
   treatment and shipped without it at first: a Stride mid-fight can equally land the PC on a
   stairway, `checkStairs()` correctly refuses to fire while `turn.mode` is still `"combat"`, and
   then *nothing rechecked it once the fight ended* — the run measured a wall of `"unfinished"`
   results in `balance.mjs` (not a low win rate; a chunk of full-health runs that never resolved at
   all) until `endCombat()` and `begin()` both learned to ask `checkStairs()` the same question
   `checkTreasure()` already knew to ask.

**What did not need to change at all**: creatures, commands, items, lore, and the gate/treasure
conditions are already keyed by id and reusable across areas with zero modification — a second
area's guardian is a normal entry in `creatures`, not a new kind of thing.

---

## 12. A third area, worked: the undercroft — and what it actually cost

The paragraph that used to end §11 said a third area would cost the same six items above. **It
cost none of them.** The undercroft — `areas.undercroft` in the shipping pack, between the vault
and the sanctum — is a diff to `content/vault.json` and this document, and nothing else:

* one legend, one grid, one `hint`, one `tuning` block;
* one placement of a creature that already existed (`shattered-sentinel`);
* one `lore` entry, carrying the boon of §7;
* two edits to squares that already existed: the vault's `V` now points at it, and its own `A`
  points on to the sanctum.

That is the claim this phase was written to make good on, and the six items above are why: they
were about the engine learning that "more than one area" is a shape, and that work was already
paid for. What the third area *did* need that the six did not provide was a way for a pack to
hand out a reward, which is why `restore` moved from a gate-only field to a shape a `lore` entry
carries too (§7). One room's worth of engine change, once, for every room after it.

**Three things a third area teaches that a second one cannot.**

1. **A stairway you land on is a stairway you immediately take again.** The undercroft's arrival
   square is `1,9`, plain floor, and the room's own exit is at `14,3`. Point a `to` at a `stairs`
   tile and `checkTriggers` fires `checkStairs` on arrival and sends the heir straight back, for
   ever. The vault→sanctum pair never showed this because the sanctum has no stairway at all.
2. **A room in the middle moves the dice under every room after it.** The undercroft's fight
   consumes RNG, so the warden fight downstream rolls differently and ends with the heir standing
   somewhere else. That alone dropped "read the reliquary plaque" from 64% of runs to 5.3% —
   because the plaque sat directly behind the casket from the stairway's landing, so the walk to
   read it crossed the casket lid and won the run first. It had *always* been that fragile; the
   third area is only what made it visible. The plaque moved west, and it reads 74.6% now. If you
   add a room, re-read the optional-pillar lines in `balance.mjs`'s report, not just the win rate.
3. **An optional fight has to be measurably optional.** `test/smoke.mjs` asserts, square by
   square, that nothing on the route from the arrival to the exit is within the room's own
   `noticeFeet` of the sentinel with a line of sight to it, and that stepping into the west
   doorway is. The 20 ft in that room's `tuning` is what makes that true.

**Is it neither free nor a wall?** `balance.mjs` at 2000, per area and per encounter:

| | reached | died there | share of all damage |
| --- | --- | --- | --- |
| Vesper Quill (wizard) | 84.5% | 4.9% | 16.8% |
| Kessa Vane (fighter) | 75.5% | 6.1% | 12.1% |

And what the boon is worth, measured with `--variant no-boon='{"lore":{"mason-mark":{"restore":[]}}}'`:
**+5.2 points to the wizard, +1.4 to the fighter.** The room costs a wizard 4.5 points of win rate
and pays her 5.2; it costs the fighter 6.3 and pays her 1.4. That is the honest reading and it is
worth writing down: **the mason's mark is a caster's boon, and Kessa should walk past it.**
Raising `restoreHp` from 8 to 12, or to a full heal, moves neither build by a measurable amount —
the fight that kills after the mark is not one HP decides. Optional content that one build should
decline is content doing its job; optional content nobody can tell apart is not.

The autopilot has no such choice — it walks to every pillar — so the shipped win rates
(**79.5% wizard, 69.3% fighter**, from 81.4% and 75.1% before this room existed) are the floor of
"always take the fight", not the ceiling of playing well.

---

## 13. More than one pack: the manifest, and `packId`

`main.js` used to `fetch("../content/vault.json")` by a literal URL, so "a second adventure" was a
code change. It reads `content/packs.json` now:

```json
{
  "schema": 1,
  "default": "vault-beneath-the-court",
  "packs": [
    { "id": "vault-beneath-the-court", "file": "vault.json", "name": "…", "blurb": "…" },
    { "id": "proving-ground", "file": "proving-ground.json", "name": "…", "blurb": "…" }
  ]
}
```

* `?pack=<id>` picks one. An id the manifest does not list falls back to the default rather than
  failing — a query string is a thing a player can mistype, and the adventure is what they came
  for.
* `file` is a **bare filename**, resolved beside the manifest. A path is refused, not resolved:
  packs are content, they live in one folder, and a manifest that can climb out of it is a
  manifest that can be pointed at anything the host serves.
* A pack file whose own `pack.id` disagrees with the manifest's name for it is refused at fetch.
  That id is what the save layer keys a slot on, and two names for one adventure is how a vault
  save ends up in another slot.

**`content/proving-ground.json` is the second pack**: one room, one build, one creature, two
commands, one pillar, one strongbox. It exists to prove a pack is portable — nothing in `js/`
names any of its ids — and to give `test/smoke.mjs` a fixture it can break in ways it would never
break the shipping pack. If you are writing a third pack, copy that one, not the vault.

There is exactly one content id the engine knows by name: **`potion`**, which `game.js`'s
`potionCount()` counts for the inventory panel and the autopilot's drink-when-low branch. A pack
that calls its healing item something else still works and still heals; that one branch goes
quiet. The proving ground uses the id on purpose and says so in its `startingInventoryNote`.

**Saves do not cross packs, and each pack has its own key.** `save.js`:

* `absalom-inheritance-save-v1` is and remains the vault's key — locked decision #36 is about what
  is already on somebody's disk, not about what the string looks like. Every other pack gets
  `absalom-inheritance-save-v1:<packId>`. One shared key would mean opening the proving ground
  overwrites a vault run the first time the autosave ticks.
* A save whose `packId` names a different adventure is **refused**, and the slot carries the
  sentence explaining it (`slot.refusedBecause`), which `main.js` puts in the save bar and which
  replaces gvb-save's generic "that is not a valid save" on an import. `repair` is built to
  survive a pack that *lost* an area or a creature; handed a whole different adventure it would do
  all of that at once and hand back a technically valid run with nothing in it.
* A save with **no** `packId` predates the field and means the pack that existed then — the same
  argument `repair`'s `buildId` fallback makes.
