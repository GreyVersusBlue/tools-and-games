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

## 3. `pc`

```json
"pc": {
  "name": "Vesper Quill", "title": "Human Wizard 1", "note": "Trained proficiency +3",
  "hp": 15, "ac": 15, "acNote": "10 + DEX 2 + Trained unarmored +3",
  "speed": 25, "perception": 5,
  "saves": { "fort": 4, "ref": 5, "will": 6 },
  "spellDC": 17, "spellAttack": 7, "slots": 2, "focus": 1
}
```

`hp`, `ac` and all three `saves` are required. `slots` and `focus` set both the starting count
and the maximum, and the number of gems drawn in the left panel — the sheet is built from this
object, so it cannot drift from the rules the engine is applying.

`perception` is the initiative modifier.

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
as The Fourth Quarter's staffer whose missing walking speed became a NaN (`gvb-site-handoff-v7.md`
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

## 8. `area`

```json
"area": {
  "id": "vault", "name": "The Vault Beneath the Ascendant Court",
  "legend": {
    "#": { "tile": "wall" },
    ".": { "tile": "floor" },
    "G": { "tile": "gate" },
    "T": { "tile": "treasure" },
    "P": { "tile": "pillar", "lore": "bequest" },
    "@": { "tile": "floor", "spawn": "pc" },
    "e": { "tile": "floor", "creature": "shattered-sentinel" },
    "k": { "tile": "floor", "creature": "vault-keeper", "wakesOn": "gate-opened" }
  },
  "rows": ["######", "#.@..#", "######"]
}
```

`tile` is `floor`, `wall`, `gate`, `pillar` or `treasure`. Walls and pillars block movement and
sight; a gate blocks both until it opens; treasure is walkable.

A legend entry may also carry:

* `spawn: "pc"` — where the PC starts. Exactly one square must have it.
* `lore: "<lore id>"` — makes a `pillar` readable.
* `creature: "<creature id>"` — places one. Repeat the character to place several of the same
  kind; each gets its own identity from its coordinates.
* `wakesOn: "notice"` (default) or `"gate-opened"` — `gate-opened` keeps a creature dormant no
  matter how close you get, until the gate opens.

Rules the loader enforces: every row the same length, every character in the legend, every
`lore` and `creature` reference resolvable, at least one PC spawn, at least one creature.

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
  "requiresDown": ["vault-keeper"],
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
wins. Without it the boss is skippable: the casket is fifteen feet inside the door and one
Stride away.

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

## 11. Adding a second area

Not supported yet, and it is the biggest single thing this content format is missing.

`area` is one object, not an array, and there is no transition trigger, no per-area save slice
and no "which area am I in" in the run state (`areaId` is written and validated but only ever
holds one value). The pieces that would need to change:

1. `content.js` — parse `areas: []`, keyed by id.
2. `game.js` — `run.areaId`, a `world` per area, and a `stairs` tile kind whose legend entry
   names a destination area and square.
3. `save.js` — `repair` currently discards the fog bitfield when its length does not match the
   one area; it would need a bitfield per visited area.
4. `render.js` and `ui.js` — rebuild on transition. The renderer already measures itself every
   frame, so a new grid size needs no extra work there.

Everything else — creatures, commands, items, lore, the gate and treasure conditions — is
already keyed and reusable across areas.
