# Conversion Codex: the Foundry VTT export, and special abilities

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

## Special abilities: what is rewritten in 2e form

`js/abilities.js` rewrites a special ability when one of its rules reads the
ability's whole construction, and leaves it alone otherwise (HISTORY #894, and
#899 for the second set of rules). An
ability left alone keeps the text it had before the rules existed, PF1e
sentences with DCs and action costs converted, and wears a **PF1e wording**
mark on the page, `[PF1e wording]` in the copied text, and a line in the
Foundry file's private notes. Nothing is rewritten on a guess.

`data/ability-patterns.md` is the measurement, written by
`node Pathfinder/converter-assets/measure-abilities.mjs` over the 57 stat
blocks in `Pathfinder/tests/fixtures/pf1`. On 2026-10-06, of 111 abilities:

| How the text was written | Abilities | Share |
| --- | ---: | ---: |
| By a rule | 33 | 30% |
| The converter's wording for a universal ability (`UMR_TEXT`), with nothing left over | 6 | 5% |
| PF1e wording, marked | 65 | 59% |
| A bare name, no text in the stat block | 7 | 6% |

Before the rules it was 1, 6, 97 and 7: the one was the red dragon's breath,
and the hell hound's breath read "6d4 rounds damage". After the first set of
rules (2026-10-05) it was 22, 6, 76 and 7.

The 57 fixtures are every PF1e stat block in the repo. The converter ships
spell data and PF2e tables and no creatures of its own, so there is no wider
set to measure against, and 30% is a share of these 57 and nothing else. The
second set of rules was picked to offset that: six of its seven read a
construction PF1e writes on the stat line in one fixed form for every creature
that has it, and the made-up blocks in the suite are not fixtures.

The rules, and what each one reads:

| Rule | PF1e construction | What it writes | Fixtures |
| --- | --- | --- | ---: |
| affliction | A poison or disease stat line delivered by injury, whose effect is ability damage, one of five conditions (`sleep`, `unconsciousness`, `paralysis`, `sickened`, `nauseated`, each with or without `for 1 minute`), or both: `Bite—injury; save Fort DC 13; frequency 1/round for 6 rounds; effect 1d3 Dex damage; cure 1 save` | The poison or disease trait, the Strike that delivers it, `Saving Throw DC`, `Onset`, `Maximum Duration`, one stage | 7 |
| constrict | `constrict (1d4+3)`, `constrict (slam, 1d8+6)` | One action, damage, a basic Fortitude save | 4 |
| throw-rock | `rock throwing (120 ft.)` | One action, a ranged Strike with that range increment | 3 |
| breath (in `convert.js`) | `breath weapon (40-ft. cone, DC 19, 6d10 fire)` | Two actions, area, damage, a basic save, a 1d4-round recharge | 2 |
| distraction | `distraction (DC 15)` | A Fortitude save or sickened 1 | 2 |
| gaze | `Turn to stone permanently, 30 feet, Fortitude DC 16 negates.` | The visual trait, the range, a save at the start of a turn | 2 |
| rend | `rend (2 claws, 1d6+7)` | One action, the Strike named, that Strike's damage | 2 |
| trample | `trample (2d8+10, DC 21)` | Three actions, damage, a basic Reflex save | 1 |
| limit | A name and a per-day limit, with or without a DC, and nothing else: `grave touch (9/day)`, `power over undead (9/day, DC 18)` | `Frequency 9 times per day.`, and the DC if there was one. No effect: the stat block gives none | 3 |
| channel | `channel negative energy 3/day (DC 11, 1d6)`, positive the same | Two actions, the void or vitality trait, a Frequency, damage in 30 feet with a basic Will save, or healing instead | 2 |
| grab | `grab (Large)`, `grab (any size)` | The text a bare Grab gets and one sentence on the size it can Grab | 2 |
| paralysis | `paralysis (1d4+1 rounds, DC 13)`, and a third clause with no figure in it | The incapacitation trait, a Fortitude save or paralyzed for that long, the clause as a sentence | 1 |
| pull | `pull (tongue, 5 feet)`, `push (arm, 10 feet)` | One action after a hit with the Strike named, the distance | 1 |
| rake | `rake (2 claws +7, 1d4+3)`, talons the same | One action on a grabbed creature, that many Strikes, the attack bonus and the damage | 1 |

Where the numbers come from:

- **A DC** is the spell DC table's figure for the creature's new level, at the
  tier the PF1e DC held for its CR. It is the same arithmetic that rescales a
  DC in unrewritten text. Constrict has no DC in PF1e and takes the moderate
  DC for the level.
- **Damage** for constrict, trample and rend is the converted damage of the
  Strike PF1e wrote the same dice for (the choker's constrict is its
  tentacle's). Where no Strike has those dice it is scaled by the ratio the
  creature's first primary Strike was scaled by, and stops at extreme Strike
  damage for the level (the darkmantle, the gorgon).
- **Ability damage** becomes the condition PF2e uses for it: Strength is
  enfeebled 1, Dexterity clumsy 1, Constitution drained 1, and Intelligence,
  Wisdom or Charisma stupefied 1. A poison gets one stage. PF1e's "cure 2
  consecutive saves" is dropped, since a PF2e affliction ends by its stages.
- **An attack bonus** (rake) is rescaled the way a Strike's is. The griffon's
  rake and its talons are both +7 in PF1e and both +13 after.
- **Channel damage** is scaled by the ratio the creature's first primary
  Strike was. The war priest's 1d6 comes out 1d6-1, under PF1e's figure,
  because its greatsword came down from 2d6+4 to 1d6+5. The 30 feet is the
  burst every PF1e channel has; the stat line never writes it.
- **A poison's condition**: sleep and unconsciousness are unconscious,
  paralysis is paralyzed, sickened and nauseated are both sickened 1. Its own
  duration is written only when it differs from the stage's interval.
- **Carried as written**, because the converter has no figure of its own: a
  range, an onset, a duration, an area, a use limit, a size. A PF1e paralysis
  of 1d4+1 rounds is long for PF2e; the rule keeps it and adds the
  incapacitation trait, and does not shorten it.
- "The save DC is Constitution-based." is dropped from a rewritten ability.
  Any other sentence after the construction is kept as it was.

What a rule will not read, on purpose: a poison delivered by contact or
breath, a poison whose effect is a condition outside the five (dazed,
staggered), a stat line in the middle of a paragraph (the iron golem's breath), a
gaze whose effect is not petrification, a rend or a pull that names a Strike
the creature does not have, a per-day limit with anything beside it but a DC
(`+1, 6/day`), a limit that is not per day (`at will`, `1/10 minutes`), a limit
on a universal ability, which keeps its own text, a rake with no attack bonus,
a channel whose dice are not d6, and a parenthesis the stat block cut off.

**The save inside a sentence was looked at and not taken.** "must succeed on a
DC N save or be [condition] for [duration]" is in five abilities (the
gelatinous cube's Paralysis, Gibbering, Spittle, Unholy Nimbus, Paralytic
Tentacles), and in every one it sits between sentences no rule reads: what the
slime is, when the nimbus bursts, what the tentacles do next. A rule that
rewrote the one sentence would take the PF1e mark off the rest. It needs a
fourth kind of wording first (part by rule, part PF1e, marked as such), which
is a call for the page, the copied text and the Foundry notes together.

What is still PF1e wording, by how often it turns up in the 65 (an ability
with two is counted twice): a save DC inside a sentence, 25; damage dice, 17;
a use limit, 11; an action cost, 10; a radius or an area, 8; a parenthesis
with no rule ("PF1e: DC 29."), 6; a condition with a duration, 5. 27 hold none
of these and are prose a rule cannot read (the balor's Whip Mastery, the
doppelganger's Mimicry). What a next rule could take whole, one or two
fixtures each: the burst that "deals N damage to anything within N feet
(Reflex DC N halves)" (the balor's Death Throes, in both layouts);
`swallow whole (1d4 bludgeoning damage, AC 10, 1 hp)`, which needs a Rupture
figure the tables do not have; `whirlwind (1/10 minutes, 10-50 ft. tall,
1d8+4 damage, DC 17)`; `energy drain (2 levels, DC 22)`. A name with only a
DC (`dominate (DC 22)`) has no effect to write.

`Pathfinder/tests/converter-abilities.test.mjs` holds all of it, 192 checks:
32 real abilities to the letter, the DCs against the table, 29 made-up blocks
one step away from a rule and 25 more a rule must read to the letter, and a
hash of everything no rule wrote, taken from the converter as it stood before
the rules. That hash still covers 98 entries: the 89 of the 111 that no rule
wrote on 2026-10-05, and the 9 the count leaves out (seven Reactive Strikes,
the troll's regeneration, the vampire's fast healing). The second set of
rules took 11 of the 98. The suite writes those 11 back in as they stood and
asks for the same hash, so the 87 left are held to the same bytes.

## The rest of the folder

`js/` is the page (`parse-pf1.js`, `convert.js`, `abilities.js`, `spells.js`,
`tables.js`, the two `ui-*.js`). `data/README.md` covers the spell lists and the spell map.
`flag-partials.mjs` writes `data/spell-map-review.md`. `vendor-embeds.mjs`
and `vendor-foundry-vocab.mjs` regenerate the two files cut from the
Archive's data.
