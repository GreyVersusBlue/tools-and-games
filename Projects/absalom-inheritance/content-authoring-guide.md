# The Absalom Inheritance — Content Authoring Guide

**Audience:** a future session, or a careful human, writing a new area for this engine.

Everything the game knows about the world is in `content/vault.json`. The engine has no
hardcoded map, no hardcoded statblock and no hardcoded spell. `content/vault.json` is the
shipping adventure and is always the authoritative worked example — when this document and
that file disagree, the file is right and this document has a bug.

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

## 2. `tuning`

```json
"tuning": { "visionFeet": 30, "noticeFeet": 30, "standardDC": 15 }
```

| Key | Does |
| --- | --- |
| `visionFeet` | How far the PC sees. Fog of war beyond it; explored squares stay dimly drawn. |
| `noticeFeet` | How close the PC gets before a dormant creature with line of sight wakes. |
| `standardDC` | The level-appropriate standard DC. Not currently read by any command — see the warning below. |

**A knob nobody reads is worse than no knob.** Torchbearer's guide audit next door found six
documented engine hooks that did nothing. `standardDC` is the one field here in that category:
it is loaded and defaulted but no command consumes it yet. It is kept because the first skill
check added to this engine will want it. Everything else in this document is wired.

---

## 3. `pcOptions`

Character creation (round three) turned the single `pc` object into an array of buildable
characters. Each entry is the same character sheet round one and two always had, plus an `id`,
a `blurb` for the picker screen, and its own `commands` — which of the pack's global `commands`
(§4) that build can actually use.

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
    "commands": ["strike", "shield", "splash", "breathe", "fang", "potion"]
  },
  {
    "id": "fighter",
    "name": "Kessa Vane", "title": "Human Fighter 1",
    "blurb": "...",
    "hp": 18, "ac": 14, "speed": 25, "perception": 6,
    "saves": { "fort": 6, "ref": 4, "will": 1 },
    "commands": ["strike-sword", "potion"]
  }
]
```

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

Every command needs `id`, `name`, `cost` (1–3) and `kind`. `flavour` renders in parentheses,
`costGlyph` defaults to that many `◆`, `hint` is shown when the command is armed, and `note` is
the button's tooltip.

| `kind` | Needs | Does |
| --- | --- | --- |
| `attack` | `attackBonus`, `damage` | Attack roll vs the target's AC. Target must be adjacent. Crits double. |
| `cone` | `coneFeet`, `damage`, `save` | Everything within the cone rolls a basic save vs `pc.spellDC`. |
| `unerring` | `rangeFeet`, `damage` | No roll, no save. Needs line of effect. |
| `self-buff` | `acBonus` | Circumstance bonus to AC until the start of your next turn. |
| `self-heal` | `healing` | Heals the PC. |
| `consume` | `healing`, `consumes` | Heals, and destroys one matching item. The only kind usable outside an encounter. |

Costs and resources:

* `spendSlot: true` — consumes a spell slot; the command is unavailable at zero.
* `spendFocus: true` — consumes the focus point.
* `consumes: "<item id>"` — unavailable when no such item is in the satchel.
* `agile: true` — on an `attack`, uses the agile MAP of −4/−8 instead of −5/−10. The shipping
  dagger is agile and the original build was not modelling it.

`damage` and `healing` are stat-block strings: `"1d6"`, `"2d6"`, `"1d4+1"`, `"1d8-1"`. A string
this engine cannot parse **throws at load**. That is the point; `"1d6+"` used to be a sentinel
that hit for nothing.

`save` is `"fort"`, `"ref"` or `"will"` and is read off the target creature's `saves`.

The cone is an approximation: within `coneFeet`, and within ±45° of the bearing you clicked. A
true PF2e cone template is a different shape. On a 22-square grid the difference is small, and
the renderer paints the squares it will hit before you commit, so a player is never guessing.

---

## 5. `creatures`

Keyed by id.

```json
"shattered-sentinel": {
  "name": "Shattered Sentinel", "level": -1,
  "hp": 11, "ac": 13, "perception": 2, "speed": 20,
  "saves": { "fort": 5, "ref": 1, "will": 0 },
  "attackBonus": 4, "attackName": "Fist", "damage": "1d6", "damageType": "bludgeoning",
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

### Creature AI

There is one behaviour and it is not configurable: Stride toward the nearest open square beside
the PC, Strike when adjacent, three actions a turn, MAP applied. If you want something that
casts, retreats or calls for help, that is engine work in `runCreatureTurn`, not a content field.

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

---

## 8. `areas`, `startArea`, `areaOrder`

The pack can hold more than one area now — round two's actual change, not a plan for one. `area`
(singular) no longer exists; `areas` is an object keyed by area id, `startArea` names the one the
PC begins in, and `areaOrder` (optional; defaults to the object's own key order) is the sequence
a session or a test walking the whole adventure should expect to visit them in.

```json
"startArea": "vault",
"areaOrder": ["vault", "sanctum"],
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
    "legend": { "#": { "tile": "wall" }, ".": { "tile": "floor" }, "T": { "tile": "treasure" } },
    "rows": ["######", "#....#", "######"]
  }
}
```

`tile` is `floor`, `wall`, `gate`, `pillar`, `treasure` or `stairs`. Walls and pillars block
movement and sight; a gate blocks both until it opens; treasure and stairs are both walkable and
sight-transparent — a stairway is a floor tile with a destination attached, nothing more.

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

Rules the loader enforces, per area: every row the same length, every character in the legend,
every `lore` and `creature` reference resolvable, at least one creature, a `pc` spawn if (and only
if) this is the start area. Across areas: `startArea` must name a real one, `areaOrder` may only
list real ones, and every `stairs` destination must name a real area and land inside its bounds.

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

A third area would cost the same six items above and nothing more structural — there is no per-area
count baked in anywhere that a third area would have to unwind.
