# Special abilities: how each is worded

Written by `node Pathfinder/converter-assets/measure-abilities.mjs`. Do not edit by hand:
`converter-abilities.test.mjs` fails when this file is not what the script writes.

57 stat blocks in `Pathfinder/tests/fixtures/pf1` (three are a second layout of a creature
already there: `balor-collapsed`, `npc-war-priest-wrapped`, `d20pfsrd-owlbear`), 111 abilities on the
converted creatures. Regeneration and fast healing are numbers on the HP line and Reactive
Strike comes from a feat, so none of the three is counted.

| How the text was written | Abilities | Share |
| --- | ---: | ---: |
| A rule in `js/abilities.js`, or the breath weapon rule in `js/convert.js` | 22 | 20% |
| The converter's wording for a universal ability (`UMR_TEXT`) | 6 | 5% |
| PF1e wording, DCs and action costs converted, marked "PF1e wording" | 76 | 68% |
| A name with no text in the stat block | 7 | 6% |

## By rule

| Rule | Abilities | Creatures |
| --- | ---: | --- |
| affliction | 6 | dire-rat, ghoul, giant-ant, giant-centipede, medusa, wyvern |
| constrict | 4 | choker, chuul, darkmantle, mimic |
| throw-rock | 3 | fire-giant, frost-giant, hill-giant |
| breath | 2 | hell-hound, young-red-dragon |
| distraction | 2 | army-ant-swarm, bat-swarm |
| gaze | 2 | basilisk, medusa |
| rend | 2 | glabrezu, troll |
| trample | 1 | gorgon |

## What the PF1e wording holds

The 76 abilities no rule rewrote, by the constructions in their text. An ability with two
constructions is counted under both.

| Construction | Abilities |
| --- | ---: |
| a save DC in a sentence | 30 |
| damage dice | 21 |
| only a parenthesis from the stat line ("PF1e: 9/day.") | 16 |
| a use limit ("3/day", "once per day", "once every 1d4+1 rounds") | 15 |
| an action cost ("as 2 actions", "as a free action") | 10 |
| a radius or an area ("within 60 feet", "10-foot cube") | 8 |
| a condition with a duration ("paralyzed for 3d6 rounds") | 5 |
| a poison or disease stat line | 2 |
| a breath weapon | 2 |
| none of these | 27 |

## Not rewritten, by name

PF1e wording and bare names together, most frequent first.

| Ability | Times | Creatures |
| --- | ---: | --- |
| Flaming Body | 4 | balor-collapsed, balor, balor-collapsed, balor |
| Entangle | 3 | balor-collapsed, balor, erinyes |
| Unholy Aura | 3 | balor-collapsed, balor, nalfeshnee |
| +1 On Attack Rolls Against Goblinoid And Orc Humanoids | 2 | npc-war-priest-wrapped, npc-war-priest |
| All-Around Vision | 2 | gibbering-mouther, medusa |
| Amorphous | 2 | gibbering-mouther, gibbering-mouther |
| Breath Weapon | 2 | gorgon, iron-golem |
| Channel Negative Energy 3/Day | 2 | npc-war-priest-wrapped, npc-war-priest |
| Death Throes | 2 | balor-collapsed, balor |
| Destructive Smite | 2 | npc-war-priest-wrapped, npc-war-priest |
| Drain Life | 2 | succubus, vampire |
| Engulf | 2 | gelatinous-cube, gibbering-mouther |
| Grab | 2 | choker, darkmantle |
| Immunity To Magic | 2 | iron-golem, stone-golem |
| Paralysis | 2 | gelatinous-cube, ghoul |
| Vorpal Strike | 2 | balor-collapsed, balor |
| Whip Mastery | 2 | balor-collapsed, balor |
| Acid | 1 | gelatinous-cube |
| Adhesive | 1 | mimic |
| Air Mastery | 1 | djinni |
| Children Of The Night | 1 | vampire |
| Cling | 1 | army-ant-swarm |
| Consume | 1 | army-ant-swarm |
| Crafty | 1 | kobold |
| Create Spawn | 1 | vampire |
| Death Roll | 1 | crocodile |
| Dominate | 1 | vampire |
| Drink Blood | 1 | gibbering-mouther |
| Fear | 1 | lich |
| Freeze | 1 | gargoyle |
| Gibbering | 1 | gibbering-mouther |
| Grave Touch | 1 | lich |
| Ground Manipulation | 1 | gibbering-mouther |
| Hand Of The Apprentice | 1 | npc-battle-mage |
| Heated Rock | 1 | fire-giant |
| Hold Breath | 1 | crocodile |
| Mimic Object | 1 | mimic |
| Mimicry | 1 | doppelganger |
| Paralytic Tentacles | 1 | chuul |
| Paralyzing Touch | 1 | lich |
| Perfect Copy | 1 | doppelganger |
| Poison | 1 | homunculus |
| Power Over Undead | 1 | lich |
| Powerful Blows | 1 | iron-golem |
| Profane Gift | 1 | succubus |
| Pull | 1 | giant-frog |
| Quickness | 1 | choker |
| Rake | 1 | griffon |
| Rust | 1 | rust-monster |
| Scent Metals | 1 | rust-monster |
| Slow | 1 | stone-golem |
| Spittle | 1 | gibbering-mouther |
| Sprint | 1 | crocodile |
| Strangle | 1 | choker |
| Superior Two-Weapon Fighting | 1 | ettin |
| Swallow Whole | 1 | giant-frog |
| Telepathic Link | 1 | homunculus |
| Tongue | 1 | giant-frog |
| Transparent | 1 | gelatinous-cube |
| Unholy Nimbus | 1 | nalfeshnee |
| Whirlwind | 1 | djinni |
| Wounding | 1 | bat-swarm |
