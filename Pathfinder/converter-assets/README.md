# Conversion Codex: the Foundry VTT export

`converter.html` turns a First Edition stat block into a Remaster creature.
The **Foundry JSON** button beside Copy and Print saves that creature as a
file Foundry's pf2e system reads with **Import Data** on an NPC actor.

The code is `js/foundry.js`: `toFoundry(creature, { spellIndex })`, the
converter's output in, a plain object out. It is pure and deterministic. The
same stat block gives the same bytes, and item ids are hashed from the
creature's name, level and the item, never drawn at random. Every number in
the file is the converter's own; `foundry.js` computes none.

**It has not been imported into a real Foundry.** It was built on a machine
with no Foundry and no network source to copy a schema from. Devon's import is
the real test. `Pathfinder/tests/converter-foundry.test.mjs` holds it to the
two things that can be checked here: the converter's numbers, and the shape of
the pf2e system's own NPCs.

## What shape it targets

The pf2e system's NPC actor as its compendium NPCs were on **2026-09-09**,
the date `Pathfinder/data/npcs/` was last copied from the system's packs.
That folder is 6,392 of the system's own NPC actors, 3,048 of them Remaster.
The export writes a path under `system` only if one of those Remaster NPCs
has it, and the suite fails if it writes one they do not.

The files do not record a system version: `fetch json data.py` strips
`_stats`. My reading is that this is the shape of pf2e system 6.x and 7.x
(Foundry v12 and v13): Perception at `system.perception.mod`, skills at
`system.skills.<skill>.base`, attributes as a bare `mod`. A system older than
6.0 kept an NPC's skills as lore items and will not read them from here. That
version range is a best reading, not something the data states.

## Fields that are sure

Sure means a printed Remaster NPC in `data/npcs` carries the same path, and
the suite checks it.

| On the sheet | Path |
| --- | --- |
| Name, type | `name`, `type: "npc"` |
| Level | `system.details.level.value` |
| Traits, rarity, size | `system.traits.value`, `.rarity`, `.size.value` |
| Perception, senses | `system.perception.mod`, `.senses[]` (`type`, `acuity`, `range`), `.details` |
| Languages | `system.details.languages.value`, `.details` |
| Skills | `system.skills.<skill>.base`; a Lore is a `lore` item with `system.mod.value` |
| Attribute modifiers | `system.abilities.<str..cha>.mod` |
| AC, saves | `system.attributes.ac.value`, `system.saves.<fortitude, reflex, will>.value`, `system.attributes.allSaves.value` |
| HP | `system.attributes.hp.value`, `.max`, `.details` (regeneration, fast healing) |
| Immunities, weaknesses, resistances | `system.attributes.immunities[]`, `.weaknesses[]`, `.resistances[]` (`type`, `value`, `exceptions`) |
| Speeds | `system.attributes.speed.value`, `.otherSpeeds[]`, `.details` |
| Strikes | `melee` items: `system.bonus.value`, `.damageRolls`, `.traits.value`, `.attackEffects.value`, `.range` |
| Spellcasting | `spellcastingEntry` items: `system.tradition.value`, `.prepared.value`, `.spelldc.dc` and `.value` (attack), `.slots` |
| Spells | `spell` items, the whole `system` block copied from `Pathfinder/data/spell.json` (Foundry's own spell), plus `system.location` |
| Abilities | `action` items: `system.actionType.value`, `.actions.value`, `.category`, `.traits.value`, `.description.value` |
| Everything else | `system.details.privateNotes` |

A slug goes into a trait, language, sense, immunity, weakness or resistance
field only if it is in `js/foundry-vocab.js`, the list of slugs those 3,048
NPCs use (`node Pathfinder/converter-assets/vendor-foundry-vocab.mjs`
regenerates it; the suite fails when it is stale). PF1e language names are
written under their Remaster names (Abyssal is chthonian) and the notes say
which.

## What is a best reading

None of these can be seen in `data/npcs`, because the fetch script strips
them. They come from what I know of Foundry, not from a file here.

- **Item `_id` and `sort`.** Sixteen characters of `A-Za-z0-9`, and a rising
  `sort` to keep the sheet in stat block order. A spell points at its
  spellcasting entry by that id, as print's do.
- **`prototypeToken.name`**, so the token is not left called "Actor".
- **What is left out.** No `img`, `flags`, `_stats`, `system.publication` or
  migration version. I expect Foundry to fill each with its default. If your
  system refuses the file, a missing one of these is the first suspect.
- **At will and constant innate spells** carry it in the name, "Charm (At
  Will)", the way print's do. `3/day` is `system.location.uses`.
- **A ranged Strike** is a `melee` item with `system.range.increment`. A PF1e
  block that gives no range increment imports as a melee Strike, and the notes
  name it.
- **Strike riders.** Extra dice ("2d6 fire") are a second damage roll. Grab,
  Knockdown and Push are attack effects. Any other rider is text in the
  Strike's description, not an effect.

## What goes into the notes instead of a field

The actor's private notes (GM only) open with what the file is, then:

- **Partial spell matches.** A spell the map calls a partial match is named
  "Massacre [partial match]" on the sheet, its text opens with the PF1e spell
  and the map's note in bold, and it is listed here.
- **Not written into a field.** Anything with no certain field: a trait or
  immunity no printed NPC has ("magic", "charm"), a sense PF2e lacks
  (blindsight stays as text beside Perception), a resistance exception, a
  conditional skill bonus, a "1/month" spell.
- **Written under its Remaster name.** Languages, and sizes below Tiny.
- **Conversion notes.** The page's own notes, word for word.

No rule text is in the file beyond what the page already shows: ability text
is the converter's, and spell text is the Archive's.

## How to check it in Foundry

1. In the Actors tab, Create Actor, type NPC, any name.
2. Right-click it in the sidebar, Import Data, and pick the downloaded `.foundry-npc.json`.
3. Look first at the top of the sheet against the page: name, level, AC, HP, the three saves, Perception.
4. Then roll one Strike's attack and damage, and open the spells: DC, attack, each spell under its rank, "[partial match]" on the ones the page marks.
5. Read the Notes tab's private notes last. If the import is refused, the red line in the browser console (F12) is the thing to send back.

## The rest of the folder

`js/` is the page (`parse-pf1.js`, `convert.js`, `spells.js`, `tables.js`, the
two `ui-*.js`). `data/README.md` covers the spell lists and the spell map.
`flag-partials.mjs` writes `data/spell-map-review.md`. `vendor-embeds.mjs`
and `vendor-foundry-vocab.mjs` regenerate the two files cut from the
Archive's data.
