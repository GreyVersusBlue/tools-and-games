# Spell map review: the weakest "partial" entries

Written by `node Pathfinder/converter-assets/flag-partials.mjs`. Do not edit it by hand:
`Pathfinder/tests/converter-spells.test.mjs` fails when this file is not what the script prints.

`spell-map.json` has 1087 entries with `fit: "partial"`. A second pass wrote them and no
person has read them. This list scores every one on what the data can show and prints the
47 that score 8 or more, weakest first. **Nothing in the map was changed.** Each entry below
is a question for Devon; the answer goes into `spell-map.json` by hand.

"Partial" already means the two spells differ, so no single reason says an entry is wrong. The
score is how many pile up on one entry. Names, the fields compared and the map's own note are
all that is printed; open the Spells tab of the Conversion Codex for either spell's text.

## What each reason measures, and what to decide

| Reason | Weight | Of 1087 | Of the 47 below | Decide |
| --- | --- | --- | --- | --- |
| text far apart | 3 | 352 | 44 | Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`? |
| two spells named | 2 | 104 | 15 | Which of the two does a stat block get? The page prints both; say in the note when to use which, or drop one. |
| rank gap | 2 | 259 | 30 | Is a spell this many ranks away a fair stand-in at the creature's level, or does the note need to say so? |
| casting time | 2 | 113 | 18 | One of the pair is cast in a fight and the other is not. Can the creature still use it, or is this `none` for a stat block? |
| focus spell | 2 | 11 | 1 | A focus spell belongs to one class or domain. Is there a slot spell that does the job instead? |
| save or defence | 1 | 280 | 23 | The target resists with a different save, or one side has none. Does the note need to say so? |
| tradition | 1 | 57 | 5 | No PF1e class list that casts this lines up with a tradition that casts the PF2e spell. Is that acceptable for the creatures that have it? |
| damage | 1 | 146 | 15 | The damage type differs, or one spell deals damage and the other does not. Is the mapped spell still the same job? |
| area against target | 1 | 137 | 11 | One covers an area and the other picks targets. Does the note need to say so? |
| duration | 1 | 179 | 16 | The durations are two or more steps apart. Does the mapped spell last long enough (or end soon enough) to do the PF1e spell's job? |
| legacy spell | 1 | 67 | 2 | The mapped spell is pre-Remaster. Is there a Remaster spell to name instead, or is legacy the best there is? |
| no shared name word | 1 | 833 | 44 | Nothing in the names ties the pair together; the note is the only evidence. Does it hold up? |
| note reused | 1 | 86 | 9 | The same note sits on three or more entries. Is it true of this one? |
| note names no mapped spell | 1 | 41 | 8 | The note does not say which mapped spell it is talking about. Rewrite it to say what the PF2e spell does and does not cover. |

How each is measured:

- **text far apart**: both descriptions as word vectors (the weighting `match-spells.py` uses). Flagged when more than 100 of the PF2e spells on file read nearer to the PF1e text than the mapped one does.
- **two spells named**: `to` holds two names.
- **rank gap**: PF1e level (the lowest on any class list) and PF2e rank are three or more apart; a cantrip counts as 0.
- **casting time**: one is cast in actions or rounds, the other takes a minute or more (every ritual does).
- **focus spell**: the mapped spell has the focus trait.
- **save or defence**: the PF1e save line names one save and the mapped spell uses another, an attack roll or none; or PF1e has no save and the mapped spell has one. A harmless PF1e save is not compared.
- **tradition**: PF1e class lists read as traditions (wizard, sorcerer, arcanist, magus, witch, bloodrager, summoner: arcane; cleric, oracle, warpriest, inquisitor, paladin, antipaladin: divine; druid, ranger, hunter, shaman: primal; bard, skald, psychic, mesmerist, occultist, spiritualist, medium: occult), and none of them casts the mapped spell. Rituals and focus spells have no tradition and are not compared.
- **damage**: a PF1e acid, cold, electricity, fire, force or sonic descriptor the mapped spell lacks; or one spell rolls damage and the other's text never says "damage".
- **area against target**: the PF1e spell has an Area line and the mapped spell has no area, or the reverse.
- **duration**: on the steps instantaneous, rounds (up to a minute), minutes, hours, days or longer, permanent, the pair is two or more apart.
- **legacy spell**: the mapped spell is from a pre-Remaster book.
- **no shared name word**: the two names share no word (greater, lesser, mass and numerals aside).
- **note reused**: the same note, word for word, is on three or more partial entries.
- **note names no mapped spell**: the note never names the spell in `to`.

Where a `to` holds two spells, every comparison but the first two is made against whichever comes
closer, so a looser second spell does not flag an entry by itself.

## Scores

| Score | Entries |
| --- | --- |
| 10 | 2 |
| 9 | 13 |
| 8 (the cut) | 32 |
| 7 | 73 |
| 6 | 98 |
| 5 | 125 |
| 4 | 170 |
| 3 | 161 |
| 2 | 201 |
| 1 | 174 |
| 0 | 38 |

`node Pathfinder/converter-assets/flag-partials.mjs --all` prints all 1087 with their reasons.

## The 47 weakest

### 1. Psychic Surgery → Clear Mind + Cleanse Affliction (score 10)

- PF1e: level 5; enchantment; occult; cast 10 minutes; save none; targets; lasts instantaneous
- PF2e Clear Mind: rank 2; divine/occult/primal; cast 2 actions; save none; targets; lasts instantaneous
- PF2e Cleanse Affliction: rank 2; divine/occult/primal; cast 2 actions; save none; targets; lasts instantaneous
- Note on file: "PF2e has no ability damage; Clear Mind/Cleanse Affliction remove mental afflictions."
- Flagged for:
  - text far apart: the mapped spell's text is the 161st nearest of 1993 PF2e spells
  - two spells named: maps to Clear Mind and Cleanse Affliction
  - rank gap: PF1e level 5 against rank 2 and rank 2
  - casting time: PF1e 10 minutes against 2 actions and 2 actions
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 2. Shades → Shadow Blast + Summon Fiend (score 10)

- PF1e: level 9; illusion; arcane; cast 1 standard action; save Will disbelief (if interacted with); varies; see text; lasts see text
- PF2e Shadow Blast: rank 5; divine/occult; cast 2 actions; save none; targets; lasts instantaneous
- PF2e Summon Fiend: rank 5; divine; cast 3 actions; save none; targets; lasts 1 minute
- Note on file: "PF2e has no shadow-conjuration mimicry; use Shadow Blast or a heightened summon."
- Flagged for:
  - text far apart: the mapped spell's text is the 123rd nearest of 1993 PF2e spells
  - two spells named: maps to Shadow Blast and Summon Fiend
  - rank gap: PF1e level 9 against rank 5 and rank 5
  - save or defence: PF1e Will disbelief (if interacted with); varies; see text against no save and no save
  - tradition: PF1e lists read arcane against divine/occult and divine
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 3. Anthropomorphic Animal → Awaken Animal (score 9)

- PF1e: level 3; transmutation; arcane/primal; cast 1 standard action; save Fortitude negates; targets; lasts 1 hour/level
- PF2e Awaken Animal: rank 6; ritual; cast 1 day; save none; targets; lasts instantaneous
- Note on file: "Awaken Animal grants intelligence rather than a hybrid form."
- Flagged for:
  - text far apart: the mapped spell's text is the 106th nearest of 1993 PF2e spells
  - rank gap: PF1e level 3 against rank 6
  - casting time: PF1e 1 standard action against a ritual of 1 day
  - save or defence: PF1e Fortitude negates against no save
  - duration: PF1e 1 hour/level (hours) against instantaneous (instantaneous)
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 4. Aura of Doom → Dread Ambience (score 9)

- PF1e: level 4; necromancy; divine/occult; cast 1 standard action; save Will negates; area; lasts 10 minute/level
- PF2e Dread Ambience: rank 5; ritual; cast 2 days; save none; targets; lasts 1 year
- Note on file: "Dread Ambience is a fear consecration; no personal aura."
- Flagged for:
  - text far apart: the mapped spell's text is the 359th nearest of 1993 PF2e spells
  - casting time: PF1e 1 standard action against a ritual of 2 days
  - save or defence: PF1e Will negates against no save
  - area against target: PF1e covers an area; the mapped spell picks targets
  - duration: PF1e 10 minute/level (minutes) against 1 year (days or longer)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 5. Dream Voyage → Umbral Journey (score 9)

- PF1e: level 9; conjuration; occult; cast 1 standard action; save Will negates; targets; lasts 1 hour/level (D)
- PF2e Umbral Journey: rank 5; arcane/occult; cast 1 minute; save none; targets; lasts 8 hours
- Note on file: "Umbral Journey speeds travel through the Netherworld instead of the Dimension of Dreams."
- Flagged for:
  - text far apart: the mapped spell's text is the 879th nearest of 1993 PF2e spells
  - rank gap: PF1e level 9 against rank 5
  - casting time: PF1e 1 standard action against 1 minute
  - save or defence: PF1e Will negates against no save
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 6. Healing Flames → Heal (score 9)

- PF1e: level 4; conjuration; divine; cast 1 standard action; save Reflex half; see text; area; lasts instantaneous
- PF2e Heal: rank 1; divine/primal; cast 1 to 3; save fortitude; targets; lasts instantaneous
- Note on file: "3-action Heal heals allies and harms undead in an area; no fire/evil component."
- Flagged for:
  - text far apart: the mapped spell's text is the 171st nearest of 1993 PF2e spells
  - rank gap: PF1e level 4 against rank 1
  - save or defence: PF1e Reflex half; see text against fortitude
  - damage: PF1e [fire] against vitality damage
  - area against target: PF1e covers an area; the mapped spell picks targets
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 7. Insect Scouts → Scouting Eye (score 9)

- PF1e: level 2; divination; arcane/divine/occult/primal; cast 1 round; save none; lasts 1d6 hours, plus 1 hour/level; see text
- PF2e Scouting Eye: rank 5; arcane/divine/occult; cast 1 minute; save none; targets; lasts sustained
- Note on file: "Scouting Eye for remote scouting."
- Flagged for:
  - text far apart: the mapped spell's text is the 479th nearest of 1993 PF2e spells
  - rank gap: PF1e level 2 against rank 5
  - casting time: PF1e 1 round against 1 minute
  - duration: PF1e 1d6 hours, plus 1 hour/level; see text (hours) against sustained (rounds)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 8. Pied Piping → Charm (score 9)

- PF1e: level 6; enchantment; occult; cast 1 standard action; save Will partial, see text; area; lasts concentration + 1 round/level
- PF2e Charm: rank 1; arcane/occult/primal; cast 2 actions; save will; targets; lasts 1 hour
- Note on file: "PF2e Pied Piping is a 10th-rank bard focus composition; Charm covers the general effect."
- Flagged for:
  - text far apart: the mapped spell's text is the 178th nearest of 1993 PF2e spells
  - rank gap: PF1e level 6 against rank 1
  - damage: PF1e [sonic] against no such trait
  - area against target: PF1e covers an area; the mapped spell picks targets
  - duration: PF1e concentration + 1 round/level (rounds) against 1 hour (hours)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 9. Rejuvenate Eidolon, Greater → Heal (score 9)

- PF1e: level 5; conjuration; arcane; cast 1 standard action; save none; targets; lasts instantaneous
- PF2e Heal: rank 1; divine/primal; cast 1 to 3; save fortitude; targets; lasts instantaneous
- Note on file: "Heal can target an eidolon."
- Flagged for:
  - text far apart: the mapped spell's text is the 182nd nearest of 1993 PF2e spells
  - rank gap: PF1e level 5 against rank 1
  - save or defence: PF1e no save against fortitude
  - tradition: PF1e lists read arcane against divine/primal
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 10. Restore Eidolon → Heal (score 9)

- PF1e: level 3; conjuration; arcane; cast 1 minute; save Will negates (harmless); targets; lasts instantaneous
- PF2e Heal: rank 1; divine/primal; cast 1 to 3; save fortitude; targets; lasts instantaneous
- Note on file: "Heal can target an eidolon."
- Flagged for:
  - text far apart: the mapped spell's text is the 169th nearest of 1993 PF2e spells
  - casting time: PF1e 1 minute against 1 to 3 actions
  - tradition: PF1e lists read arcane against divine/primal
  - damage: Heal deals vitality damage; the PF1e text has no damage
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 11. Sea of Dust → Control Water (score 9)

- PF1e: level 9; transmutation; primal; cast 1 hour; save none; area; lasts permanent
- PF2e Control Water: rank 5; arcane/primal; cast 2 actions; save fortitude; targets; lasts 1 hour
- Note on file: "Control Water lowers water levels in an area."
- Flagged for:
  - rank gap: PF1e level 9 against rank 5
  - casting time: PF1e 1 hour against 2 actions
  - save or defence: PF1e no save against fortitude
  - damage: the PF1e spell rolls damage; Control Water deals none
  - area against target: PF1e covers an area; the mapped spell picks targets
  - duration: PF1e permanent (permanent) against 1 hour (hours)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is a spell this many ranks away a fair stand-in at the creature's level, or does the note need to say so?

### 12. Stolen Light → Illusory Scene (score 9)

- PF1e: level 3; illusion; arcane/occult; cast 1 full round; save Will negates (object); targets; lasts permanent or 1 minute/level (see text)
- PF2e Illusory Scene: rank 5; arcane/occult; cast 10 minutes; save none; area; lasts 1 hour
- Note on file: "Illusory Scene can replay a captured image; no gem storage mechanic."
- Flagged for:
  - text far apart: the mapped spell's text is the 130th nearest of 1993 PF2e spells
  - casting time: PF1e 1 full round against 10 minutes
  - save or defence: PF1e Will negates (object) against no save
  - area against target: PF1e picks targets; the mapped spell covers an area
  - duration: PF1e permanent or 1 minute/level (see text) (permanent) against 1 hour (hours)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 13. Symbol of Dispelling → Rune Trap + Dispel Magic (score 9)

- PF1e: level 8; abjuration; arcane/divine/primal; cast 10 minutes; save none; lasts instantaneous
- PF2e Rune Trap: rank 3; ritual; cast 10 minutes; save none; targets; lasts instantaneous
- PF2e Dispel Magic: rank 2; arcane/divine/occult/primal; cast 2 actions; save none; targets; lasts instantaneous
- Note on file: "PF2e has no trigger-glyph Symbol spells; store the effect in a Rune Trap ritual or use the listed spell directly."
- Flagged for:
  - text far apart: the mapped spell's text is the 382nd nearest of 1993 PF2e spells
  - two spells named: maps to Rune Trap and Dispel Magic
  - rank gap: PF1e level 8 against rank 3 and rank 2
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 20 partial entries
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 14. Symbol of Sealing → Lock (score 9)

- PF1e: level 4; abjuration; arcane/divine/occult; cast 10 minutes; save none; lasts permanent
- PF2e Lock: rank 1; arcane/divine/occult; cast 2 actions; save none; targets; lasts until your next daily preparations
- Note on file: "No sealing glyph; Lock secures a door, far weaker than an impassable barrier."
- Flagged for:
  - text far apart: the mapped spell's text is the 352nd nearest of 1993 PF2e spells
  - rank gap: PF1e level 4 against rank 1
  - casting time: PF1e 10 minutes against 2 actions
  - damage: PF1e [force] against no such trait
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 15. Telekinesis → Telekinetic Maneuver + Telekinetic Haul (score 9)

- PF1e: level 4; transmutation; arcane/occult; cast 1 standard action; save Will negates (object) or none; see text; lasts concentration (up to 1 round/level) or instantaneous; see text
- PF2e Telekinetic Maneuver: rank 2; arcane/occult; cast 2 actions; save attack; targets; lasts instantaneous
- PF2e Telekinetic Haul: rank 5; arcane/occult; cast 2 actions; save none; targets; lasts 1 minute
- Note on file: "PF2e split telekinesis into several separate spells (Maneuver/Haul/Rend) rather than one all-purpose spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 448th nearest of 1993 PF2e spells
  - two spells named: maps to Telekinetic Maneuver and Telekinetic Haul
  - save or defence: PF1e Will negates (object) or none; see text against attack and no save
  - damage: the PF1e spell rolls damage; Telekinetic Maneuver deals none
  - no shared name word: no word in common between the two names
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 16. Arcane Sight, Greater → Detect Magic (score 8)

- PF1e: level 7; divination; arcane/occult; cast 1 standard action; save none; targets; lasts 1 min./level (D)
- PF2e Detect Magic: cantrip; arcane/divine/occult/primal; cast 2 actions; save none; area; lasts instantaneous
- Note on file: "Heightened Detect Magic; identifying active spells needs checks."
- Flagged for:
  - text far apart: the mapped spell's text is the 531st nearest of 1993 PF2e spells
  - rank gap: PF1e level 7 against a cantrip
  - area against target: PF1e picks targets; the mapped spell covers an area
  - duration: PF1e 1 min./level (D) (minutes) against instantaneous (instantaneous)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 17. Banshee Blast → Wails of the Damned (score 8)

- PF1e: level 6; necromancy; arcane/occult; cast 1 standard action; save Reflex half and Will negates (see text); area; lasts instantaneous and 1 round/level (see text)
- PF2e Wails of the Damned: rank 9; divine/occult; cast 2 actions; save fortitude; area; lasts instantaneous
- Note on file: "Wails of the Damned is a spectral screaming area attack at rank 9."
- Flagged for:
  - text far apart: the mapped spell's text is the 383rd nearest of 1993 PF2e spells
  - rank gap: PF1e level 6 against rank 9
  - save or defence: PF1e Reflex half and Will negates (see text) against fortitude
  - damage: PF1e [sonic] against void damage
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 18. Beanstalk → Bridge of Vines (score 8)

- PF1e: level 4; conjuration; arcane; cast 1 minute; save none; lasts 24 hours
- PF2e Bridge of Vines: rank 4; arcane/primal; cast 3 actions; save reflex; targets; lasts 10 minutes
- Note on file: "Bridge of Vines grows a plant path; not a tall climbing stalk."
- Flagged for:
  - text far apart: the mapped spell's text is the 805th nearest of 1993 PF2e spells
  - casting time: PF1e 1 minute against 3 actions
  - save or defence: PF1e no save against reflex
  - duration: PF1e 24 hours (days or longer) against 10 minutes (minutes)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 19. Cold Iron Fetters → Leaden Steps + Restraining Chains (score 8)

- PF1e: level 3; conjuration; arcane/divine/occult/primal; cast 1 standard action; save Reflex negates; targets; lasts 1 round/level (D)
- PF2e Leaden Steps: rank 1; arcane/primal; cast 2 actions; save fortitude; targets; lasts 1 minute
- PF2e Restraining Chains: rank 3; arcane/occult; cast 2 actions; save none; targets; lasts 1 minute
- Note on file: "These slow or bind a target; no cold iron."
- Flagged for:
  - text far apart: the mapped spell's text is the 147th nearest of 1993 PF2e spells
  - two spells named: maps to Leaden Steps and Restraining Chains
  - save or defence: PF1e Reflex negates against fortitude and no save
  - no shared name word: no word in common between the two names
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 20. Deafening Song Bolt → Noise Blast (score 8)

- PF1e: level 5; evocation; occult; cast 1 standard action; save none; targets; lasts instantaneous
- PF2e Noise Blast: rank 2; arcane/divine/occult; cast 2 actions; save fortitude; area; lasts instantaneous
- Note on file: "Noise Blast deals sonic damage and deafens in an area rather than as bolts."
- Flagged for:
  - text far apart: the mapped spell's text is the 150th nearest of 1993 PF2e spells
  - rank gap: PF1e level 5 against rank 2
  - save or defence: PF1e no save against fortitude
  - area against target: PF1e picks targets; the mapped spell covers an area
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 21. Ectoplasmic Eruption → Entangling Flora (score 8)

- PF1e: level 6; evocation; occult; cast 1 standard action; save Reflex half and Will partial, see text; area; lasts 1 round/level
- PF2e Entangling Flora: rank 2; arcane/primal; cast 2 actions; save reflex; area; lasts 1 minute
- Note on file: "No ectoplasm burst; Entangling Flora gives the area entangle."
- Flagged for:
  - text far apart: the mapped spell's text is the 305th nearest of 1993 PF2e spells
  - rank gap: PF1e level 6 against rank 2
  - tradition: PF1e lists read occult against arcane/primal
  - damage: the PF1e spell rolls damage; Entangling Flora deals none
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 22. Entomb → Earthquake (score 8)

- PF1e: level 8; transmutation; arcane/primal; cast 1 minute; save none; lasts permanent
- PF2e Earthquake: rank 8; arcane/primal; cast 2 actions; save reflex; area; lasts 1 round
- Note on file: "No spell sinks an area; Earthquake is the nearest earth-disaster spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 363rd nearest of 1993 PF2e spells
  - casting time: PF1e 1 minute against 2 actions
  - save or defence: PF1e no save against reflex
  - duration: PF1e permanent (permanent) against 1 round (rounds)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 23. Expend → Dispel Magic (score 8)

- PF1e: level 7; abjuration; arcane; cast 1 standard action; save Will negates; area; lasts instantaneous
- PF2e Dispel Magic: rank 2; arcane/divine/occult/primal; cast 2 actions; save none; targets; lasts instantaneous
- Note on file: "No spell burns limited-use abilities; Dispel Magic is the nearest anti-magic tool."
- Flagged for:
  - text far apart: the mapped spell's text is the 750th nearest of 1993 PF2e spells
  - rank gap: PF1e level 7 against rank 2
  - save or defence: PF1e Will negates against no save
  - area against target: PF1e covers an area; the mapped spell picks targets
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 24. Find the Path → Show the Way + Wanderer's Guide (score 8)

- PF1e: level 6; divination; arcane/divine/occult/primal; cast 3 rounds; save none or Will negates (harmless); targets; lasts 10 min./level
- PF2e Show the Way: rank 3; divine/primal; cast 10 minutes; save none; area; lasts 8 hours
- PF2e Wanderer's Guide: rank 3; divine/occult; cast 1 minute; save none; targets; lasts until your next daily preparations
- Note on file: "These spells guide overland travel rather than show the exact route to a location."
- Flagged for:
  - two spells named: maps to Show the Way and Wanderer's Guide
  - rank gap: PF1e level 6 against rank 3 and rank 3
  - casting time: PF1e 3 rounds against 10 minutes and 1 minute
  - no shared name word: no word in common between the two names
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Which of the two does a stat block get? The page prints both; say in the note when to use which, or drop one.

### 25. Flesh Puppet Horde → Zombie Horde (score 8)

- PF1e: level 3; necromancy; arcane/divine/occult/primal; cast 10 minutes; save none; targets; lasts permanent (D)
- PF2e Zombie Horde: rank 3; focus; cast 2 actions; save fortitude; area; lasts 1 minute
- Note on file: "Zombie Horde (focus) raises a horde of zombies."
- Flagged for:
  - casting time: PF1e 10 minutes against 2 actions
  - focus spell: Zombie Horde: focus
  - save or defence: PF1e no save against fortitude
  - damage: Zombie Horde deals bludgeoning damage; the PF1e text has no damage
  - area against target: PF1e picks targets; the mapped spell covers an area
  - duration: PF1e permanent (D) (permanent) against 1 minute (rounds)
- Decide: keep as partial, re-map, or mark `none`. Start with: One of the pair is cast in a fight and the other is not. Can the creature still use it, or is this `none` for a stat block?

### 26. Heroic Invocation → Heroism + Band of Heroes (score 8)

- PF1e: level 9; enchantment; arcane/occult; cast 10 minutes; save Will negates (harmless); targets; lasts 10 minutes /level
- PF2e Heroism: rank 3; divine/occult; cast 2 actions; save none; targets; lasts 10 minutes
- PF2e Band of Heroes: rank 3; ritual; cast 1 hour; save none; targets; lasts 24 hours
- Note on file: "Heroism covers the morale-style bonuses; no temp HP/immunity bundle."
- Flagged for:
  - text far apart: the mapped spell's text is the 450th nearest of 1993 PF2e spells
  - two spells named: maps to Heroism and Band of Heroes
  - rank gap: PF1e level 9 against rank 3 and rank 3
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 27. Incendiary Runes → Rune Trap (score 8)

- PF1e: level 1; abjuration; arcane; cast 1 standard action; save Reflex partial; targets; lasts permanent until discharged (D)
- PF2e Rune Trap: rank 3; ritual; cast 10 minutes; save none; targets; lasts instantaneous
- Note on file: "Rune Trap ritual with a fire spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 1172nd nearest of 1993 PF2e spells
  - casting time: PF1e 1 standard action against a ritual of 10 minutes
  - save or defence: PF1e Reflex partial against no save
  - damage: PF1e [fire] against no such trait
  - duration: PF1e permanent until discharged (D) (permanent) against instantaneous (instantaneous)
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 28. Intellect Fortress II → Clear Mind (score 8)

- PF1e: level 5; abjuration; occult; cast 1 immediate action; save none; area; lasts 1 round
- PF2e Clear Mind: rank 2; divine/occult/primal; cast 2 actions; save none; targets; lasts instantaneous
- Note on file: "Clear Mind counteracts fear and emotion effects."
- Flagged for:
  - text far apart: the mapped spell's text is the 662nd nearest of 1993 PF2e spells
  - rank gap: PF1e level 5 against rank 2
  - area against target: PF1e covers an area; the mapped spell picks targets
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 3 partial entries
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 29. Last Azlanti's Defending Sword, Mass → Spiritual Guardian (score 8)

- PF1e: level 9; evocation; arcane; cast 1 standard action; save none; lasts 1 round/level (D)
- PF2e Spiritual Guardian: rank 5; divine; cast 2 actions; save none; targets; lasts 1 minute
- Note on file: "Spiritual Guardian is a force weapon that can protect allies."
- Flagged for:
  - text far apart: the mapped spell's text is the 436th nearest of 1993 PF2e spells
  - rank gap: PF1e level 9 against rank 5
  - tradition: PF1e lists read arcane against divine
  - damage: PF1e [force] against spirit damage
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 30. Planar Adaptation, Mass → Environmental Endurance + Resist Energy (score 8)

- PF1e: level 6; transmutation; arcane/divine/occult; cast 1 standard action; save Will negates (harmless); targets; lasts 1 hour/level (D)
- PF2e Environmental Endurance: rank 2; arcane/divine/primal; cast 10 minutes; save none; targets; lasts until your next daily preparations
- PF2e Resist Energy: rank 2; arcane/divine/occult/primal; cast 2 actions; save none; targets; lasts 10 minutes
- Note on file: "Combine Environmental Endurance and Resist Energy for planar hazards; heighten or cast multiple times."
- Flagged for:
  - text far apart: the mapped spell's text is the 314th nearest of 1993 PF2e spells
  - two spells named: maps to Environmental Endurance and Resist Energy
  - rank gap: PF1e level 6 against rank 2 and rank 2
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 31. Planetary Adaptation, Mass → Environmental Endurance + Resist Energy (score 8)

- PF1e: level 6; transmutation; arcane/divine; cast 1 standard action; save Will negates (harmless); targets; lasts 1 hour/level
- PF2e Environmental Endurance: rank 2; arcane/divine/primal; cast 10 minutes; save none; targets; lasts until your next daily preparations
- PF2e Resist Energy: rank 2; arcane/divine/occult/primal; cast 2 actions; save none; targets; lasts 10 minutes
- Note on file: "Combine Environmental Endurance and Resist Energy for alien environments."
- Flagged for:
  - text far apart: the mapped spell's text is the 180th nearest of 1993 PF2e spells
  - two spells named: maps to Environmental Endurance and Resist Energy
  - rank gap: PF1e level 6 against rank 2 and rank 2
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 32. Psychic Crush I → Warp Mind + Shatter Mind (score 8)

- PF1e: level 5; necromancy; occult; cast 1 standard action; save Will partial and Fortitude partial, see text; targets; lasts instantaneous
- PF2e Warp Mind: rank 7; arcane/occult; cast 2 actions; save will; targets; lasts instantaneous
- PF2e Shatter Mind: cantrip; cast 2 actions; save will; area; lasts instantaneous
- Note on file: "No single-target mental execution; use a mental damage/disabling spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 913th nearest of 1993 PF2e spells
  - two spells named: maps to Warp Mind and Shatter Mind
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 33. Psychic Crush II → Warp Mind + Shatter Mind (score 8)

- PF1e: level 6; necromancy; occult; cast 1 standard action; save Will partial and Fortitude partial, see text; targets; lasts instantaneous
- PF2e Warp Mind: rank 7; arcane/occult; cast 2 actions; save will; targets; lasts instantaneous
- PF2e Shatter Mind: cantrip; cast 2 actions; save will; area; lasts instantaneous
- Note on file: "No single-target mental execution; use a mental damage/disabling spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 748th nearest of 1993 PF2e spells
  - two spells named: maps to Warp Mind and Shatter Mind
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 34. Psychic Crush III → Warp Mind + Shatter Mind (score 8)

- PF1e: level 7; necromancy; occult; cast 1 standard action; save Will partial and Fortitude partial, see text; targets; lasts instantaneous
- PF2e Warp Mind: rank 7; arcane/occult; cast 2 actions; save will; targets; lasts instantaneous
- PF2e Shatter Mind: cantrip; cast 2 actions; save will; area; lasts instantaneous
- Note on file: "No single-target mental execution; use a mental damage/disabling spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 471st nearest of 1993 PF2e spells
  - two spells named: maps to Warp Mind and Shatter Mind
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 35. Psychic Crush IV → Warp Mind + Shatter Mind (score 8)

- PF1e: level 8; necromancy; occult; cast 1 standard action; save Will partial and Fortitude partial, see text; targets; lasts instantaneous
- PF2e Warp Mind: rank 7; arcane/occult; cast 2 actions; save will; targets; lasts instantaneous
- PF2e Shatter Mind: cantrip; cast 2 actions; save will; area; lasts instantaneous
- Note on file: "No single-target mental execution; use a mental damage/disabling spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 886th nearest of 1993 PF2e spells
  - two spells named: maps to Warp Mind and Shatter Mind
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 36. Psychic Crush V → Warp Mind + Shatter Mind (score 8)

- PF1e: level 9; necromancy; occult; cast 1 standard action; save Will partial and Fortitude partial, see text; targets; lasts instantaneous
- PF2e Warp Mind: rank 7; arcane/occult; cast 2 actions; save will; targets; lasts instantaneous
- PF2e Shatter Mind: cantrip; cast 2 actions; save will; area; lasts instantaneous
- Note on file: "No single-target mental execution; use a mental damage/disabling spell."
- Flagged for:
  - text far apart: the mapped spell's text is the 627th nearest of 1993 PF2e spells
  - two spells named: maps to Warp Mind and Shatter Mind
  - no shared name word: no word in common between the two names
  - note reused: the same note is on 5 partial entries
  - note names no mapped spell: the note does not name the mapped spell
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 37. Rapid Repair → Mending (score 8)

- PF1e: level 4; transmutation; arcane/divine/occult; cast 1 standard action; save Fortitude negates (harmless); targets; lasts 1 round/level
- PF2e Mending: rank 1; arcane/divine/occult/primal; cast 10 minutes; save none; targets; lasts instantaneous
- Note on file: "Mending repairs objects; no fast healing for constructs."
- Flagged for:
  - text far apart: the mapped spell's text is the 102nd nearest of 1993 PF2e spells
  - rank gap: PF1e level 4 against rank 1
  - casting time: PF1e 1 standard action against 10 minutes
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 38. Refuge → Return Beacon (score 8)

- PF1e: level 7; conjuration; arcane/divine/occult; cast 1 standard action; save none; targets; lasts permanent until discharged
- PF2e Return Beacon: rank 5; arcane/occult; cast 1 minute; save none; targets; lasts 1 hour; legacy
- Note on file: "Return Beacon (legacy) lets you teleport back to a prepared beacon."
- Flagged for:
  - text far apart: the mapped spell's text is the 135th nearest of 1993 PF2e spells
  - casting time: PF1e 1 standard action against 1 minute
  - duration: PF1e permanent until discharged (permanent) against 1 hour (hours)
  - legacy spell: Return Beacon (Pathfinder #166: Despair on Danger Island)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 39. Sequester → Disappearance (score 8)

- PF1e: level 5; abjuration; arcane/occult; cast 1 standard action; save none or Will negates (object); targets; lasts 1 day/level (D)
- PF2e Disappearance: rank 8; arcane/occult; cast 2 actions; save none; targets; lasts 10 minutes
- Note on file: "Disappearance hides a creature from all senses but not in suspended animation."
- Flagged for:
  - text far apart: the mapped spell's text is the 347th nearest of 1993 PF2e spells
  - rank gap: PF1e level 5 against rank 8
  - save or defence: PF1e none or Will negates (object) against no save
  - duration: PF1e 1 day/level (D) (days or longer) against 10 minutes (minutes)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 40. Sphere of Warding → Spirit Ward (score 8)

- PF1e: level 4; abjuration; arcane/divine; cast 1 standard action; save Will negates (see text); lasts 1 hour/level
- PF2e Spirit Ward: rank 1; divine/occult; cast 1 to 3; save none; targets; lasts 1 minute
- Note on file: "Spirit Ward protects against spirits/possessors but doesn't block entry or deal damage."
- Flagged for:
  - text far apart: the mapped spell's text is the 794th nearest of 1993 PF2e spells
  - rank gap: PF1e level 4 against rank 1
  - save or defence: PF1e Will negates (see text) against no save
  - duration: PF1e 1 hour/level (hours) against 1 minute (rounds)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 41. Suffocation, Mass → Suffocate (score 8)

- PF1e: level 9; necromancy; arcane/occult; cast 1 standard action; save Fortitude partial; targets; lasts 1 round/level
- PF2e Suffocate: rank 6; cast 2 actions; save fortitude; targets; lasts 1 minute; legacy
- Note on file: "No mass version exists in PF2e; Suffocate only targets one creature at a time."
- Flagged for:
  - text far apart: the mapped spell's text is the 238th nearest of 1993 PF2e spells
  - rank gap: PF1e level 9 against rank 6
  - damage: Suffocate deals bludgeoning damage; the PF1e text has no damage
  - legacy spell: Suffocate (Pathfinder #186: Ghost King's Rage)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 42. Tar Pool → Mud Pit (score 8)

- PF1e: level 5; transmutation; arcane/primal; cast 1 standard action; save Reflex partial, see text; area; lasts 1 round/level
- PF2e Mud Pit: rank 1; arcane/primal; cast 3 actions; save none; area; lasts 1 minute
- Note on file: "Mud Pit creates hindering ground; add fire damage by GM fiat."
- Flagged for:
  - text far apart: the mapped spell's text is the 1073rd nearest of 1993 PF2e spells
  - rank gap: PF1e level 5 against rank 1
  - save or defence: PF1e Reflex partial, see text against no save
  - damage: PF1e [fire] against no such trait
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 43. Track Ship → Locate (score 8)

- PF1e: level 2; divination; arcane/divine/occult; cast 1 standard action; save Will negates (object); lasts 1 hour/level
- PF2e Locate: rank 3; arcane/divine/occult; cast 10 minutes; save none; targets; lasts sustained
- Note on file: "Locate gives direction to a known object or creature; no ship-specific tracking."
- Flagged for:
  - text far apart: the mapped spell's text is the 1007th nearest of 1993 PF2e spells
  - casting time: PF1e 1 standard action against 10 minutes
  - save or defence: PF1e Will negates (object) against no save
  - duration: PF1e 1 hour/level (hours) against sustained (rounds)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 44. Transformation → Heroism + Enlarge (score 8)

- PF1e: level 6; transmutation; arcane/occult; cast 1 standard action; save none; targets; lasts 1 round/level
- PF2e Heroism: rank 3; divine/occult; cast 2 actions; save none; targets; lasts 10 minutes
- PF2e Enlarge: rank 2; arcane/primal; cast 2 actions; save none; targets; lasts 5 minutes
- Note on file: "No martial self-transformation; combine Heroism and Enlarge for the combat boost."
- Flagged for:
  - text far apart: the mapped spell's text is the 783rd nearest of 1993 PF2e spells
  - two spells named: maps to Heroism and Enlarge
  - rank gap: PF1e level 6 against rank 3 and rank 2
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 45. Unseen Crew → Phantasmal Minion (score 8)

- PF1e: level 4; conjuration; arcane/occult; cast 1 standard action; save none; lasts 1 day/level
- PF2e Phantasmal Minion: rank 1; arcane/occult; cast 3 actions; save none; targets; lasts sustained
- Note on file: "Phantasmal Minion handles simple tasks; one servant, not a ship's crew."
- Flagged for:
  - text far apart: the mapped spell's text is the 1274th nearest of 1993 PF2e spells
  - rank gap: PF1e level 4 against rank 1
  - damage: the PF1e spell rolls damage; Phantasmal Minion deals none
  - duration: PF1e 1 day/level (days or longer) against sustained (rounds)
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 46. Vinetrap → Tangling Creepers (score 8)

- PF1e: level 8; conjuration; divine/primal; cast 10 minutes; save Reflex negates (see text); area; lasts 1 hour/level (D)
- PF2e Tangling Creepers: rank 6; arcane/primal; cast 3 actions; save none; area; lasts 10 minutes
- Note on file: "Tangling Creepers binds creatures in an area; Vinetrap targets one creature."
- Flagged for:
  - text far apart: the mapped spell's text is the 1463rd nearest of 1993 PF2e spells
  - casting time: PF1e 10 minutes against 3 actions
  - save or defence: PF1e Reflex negates (see text) against no save
  - damage: the PF1e spell rolls damage; Tangling Creepers deals none
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?

### 47. Waves of Exhaustion → Day's Weight (score 8)

- PF1e: level 6; necromancy; arcane/occult; cast 1 standard action; save no; area; lasts instantaneous
- PF2e Day's Weight: rank 3; arcane/occult/primal; cast 2 actions; save fortitude; targets; lasts 1 minute
- Note on file: "Day's Weight makes one creature tired and weak; no area exhaustion."
- Flagged for:
  - text far apart: the mapped spell's text is the 1074th nearest of 1993 PF2e spells
  - rank gap: PF1e level 6 against rank 3
  - save or defence: PF1e no save against fortitude
  - area against target: PF1e covers an area; the mapped spell picks targets
  - no shared name word: no word in common between the two names
- Decide: keep as partial, re-map, or mark `none`. Start with: Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?
