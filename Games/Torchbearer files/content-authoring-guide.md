# Torchbearer — Content Authoring Guide

**Audience:** a future Claude session (or a careful human) creating JSON content packs for `torchbearer.html`, a single-file Pathfinder 2e adventure engine. Characters are built at **level 3** under Remaster rules. Everything the engine knows — ancestries, backgrounds, classes, feats, spells, items, monsters, companions, and adventures — flows through one loader. The baked-in Player Core content and the baked-in adventure use **exactly the schema described here**, so the source of `torchbearer.html` (constants `CORE_PACK` and `ADVENTURE_PACK`) is always the authoritative worked example. When in doubt, imitate it.

Packs are loaded at runtime via **Load Content JSON** on the title bar. A pack that fails validation is rejected with a list of errors; nothing is partially loaded.

---

## 1. Pack envelope

Every pack is one JSON object. Only `pack` is required; include whichever collections you need.

```json
{
  "pack": {
    "id": "orcs-of-the-hold",
    "name": "Orcs of the Hold",
    "version": "1.0.0",
    "author": "Devon",
    "type": "content",
    "description": "One line shown on the load confirmation and title screen."
  },
  "ancestries": [], "backgrounds": [], "classes": [], "feats": [],
  "spells": [], "items": [], "monsters": [], "companions": [], "adventures": []
}
```

* `type` is `"content"` or `"adventure"` (informational only; a pack may contain both kinds of material).
* **IDs are global.** Loading an object whose `id` already exists **replaces** it — this is the supported way to patch core content. Use kebab-case ids and prefix new ones (`orc-hold-…`) to avoid accidental collisions.
* Cross-references (a background's `feat`, a subclass's `grantFocusSpell`, an encounter's `monster`) may point at ids defined in *any* loaded pack, including core. Load order matters only for overrides.

---

## 2. Ancestries

```json
{
  "id": "orc", "name": "Orc", "hp": 10, "size": "Medium", "speed": 25,
  "boosts": ["str", "free"], "flaws": [],
  "traits": ["orc", "humanoid"], "languages": ["Common", "Orcish"],
  "senses": ["darkvision"],
  "desc": "One or two sentences of flavor.",
  "heritages": [
    { "id": "hold-scarred-orc", "name": "Hold-Scarred Orc",
      "desc": "Player-facing rules text.",
      "effects": [ { "bonus": { "target": "hp", "value": 2, "type": "untyped" } } ] }
  ]
}
```

* `boosts`: attribute keys (`str dex con int wis cha`) and/or the string `"free"`. Humans use `["free","free"]`.
* Every ancestry needs at least one heritage. 2–3 heritages and ~3 ancestry feats (see §5) is the core pattern.
* `senses` values the engine recognizes cosmetically: `"darkvision"`, `"low-light vision"`. Others display but do nothing mechanical.

## 3. Backgrounds

```json
{ "id": "hold-smith", "name": "Hold Smith",
  "boosts": [["str","int"], ["free"]],
  "skills": ["crafting"], "lore": "Smithing Lore",
  "feat": "quick-repair",
  "desc": "One sentence." }
```

* `boosts[0]` is the two-way choice; the free boost is implied by `["free"]` in slot 1.
* `feat` must be the id of a **skill feat that exists** after your pack loads. Its skill prerequisite should be satisfied by the background's own trained skill (the builder checks prereqs).

## 4. Classes

Study the eight core classes in the HTML source — they cover every pattern. Skeleton:

```json
{
  "id": "gunsl", "name": "…", "hp": 8, "keyAbility": ["dex"],
  "perception": "E",
  "saves": { "fort": "E", "ref": "E", "will": "T" },
  "attacks": { "simple": "T", "martial": "partial", "unarmed": "T" },
  "defenses": { "unarmored": "T", "light": "T" },
  "classDC": "T", "skillCount": 3, "trainedSkills": ["stealth"],
  "desc": "…",
  "spellcasting": null,
  "subclass": { "label": "Way", "options": [ { "id": "…", "name": "…", "desc": "…", "effects": [] } ] },
  "features": [ { "level": 1, "name": "…", "desc": "…", "special": "engine-hook-id" },
                { "level": 3, "name": "…", "effects": [ { "profUp": { "target": "save.will", "rank": "E" } } ] } ],
  "featLevels": { "class": [1,2], "skill": [2], "general": [3], "ancestry": [1] }
}
```

Key points:

* **Proficiency ranks** are `"U" "T" "E" "M" "L"`, plus the special value `"partial"` for `attacks.martial` — it means "only weapons flagged `rogueOk: true` in items" (the rogue/bard weapon list).
* `trainedSkills` entries may be a string (always trained) or an array like `[["acrobatics","athletics"]]` (grants +1 skill pick; the builder is deliberately liberal about which skill it's spent on).
* `skillCount` is the class's base number **before** Int and extras.
* Only feature levels ≤ 3 matter. Features are display-only unless they carry `effects` or a `special` (engine hook — see §8).
* `featLevels.skill` controls how many skill-feat slots appear (rogue uses `[1,2,3]`).

**Spellcasting block** (omit or `null` for martials):

```json
"spellcasting": {
  "tradition": "arcane",          // arcane | divine | occult | primal | "patron" (resolved by subclass "tradition" effect)
  "type": "prepared",             // or "spontaneous"
  "ability": "int",
  "cantrips": 5,                  // number of cantrip picks
  "slots": { "1": 3, "2": 2 },    // castable slots per rank at level 3
  "repertoire": { "1": 4, "2": 2 },  // spontaneous only: spells known per rank
  "grantCantrips": ["courageous-anthem"]  // auto-known, on top of picks
}
```

The engine treats slots as a per-rank pool (prepared casting is simplified to "your list + a pool"). Cantrips auto-heighten to rank ⌈level/2⌉ = 2.

## 5. Feats

```json
{ "id": "orc-ferocity", "name": "Orc Ferocity", "type": "ancestry", "ancestry": "orc",
  "level": 1, "actions": "reaction", "traits": ["orc"],
  "desc": "Player-facing text.", "effects": [ { "special": "orc-ferocity" } ],
  "prereq": { "skill": { "athletics": "T" } } }
```

* `type`: `ancestry` (requires `"ancestry"` field) · `class` (requires `"classes": ["fighter", …]` array — shared feats list several classes) · `skill` · `general`.
* `level` gates which slot can take it (slots exist at 1 and 2 for class feats; 3 for general).
* `actions`: omit for passives, or `1`/`2`/`"reaction"`/`"free"` (display only — combat behavior comes from `special`).
* `prereq.skill` is the only enforced prerequisite form.

## 6. The effects DSL

`effects` arrays appear on heritages, subclass options, class features, and feats. Each entry is one of:

| Effect | Shape | What the engine does |
|---|---|---|
| `bonus` | `{"bonus":{"target":"speed"\|"hp"\|"initiative","value":n,"type":"status"\|"circumstance"\|"untyped"}}` | Applied numerically at character finalize. A `"vs"` field (e.g. `"vs":"seek"`) demotes it to a displayed note. |
| `profUp` | `{"profUp":{"target":"perception"\|"save.fort"\|"save.ref"\|"save.will","rank":"E"}}` | Raises proficiency if higher. Optional `"ifSubclass":"warpriest"` substring-matches the chosen subclass id. |
| `attackProf` / `armorProf` | `{"attackProf":{"martial":"T"}}` | Merges weapon/armor proficiencies (also unlocks those items in the gear step). |
| `trainSkill` | `{"trainSkill":"nature"}` or `"choice"` | Fixed training, or +1 skill pick in the builder. |
| `grantLore` | `{"grantLore":"Bardic Lore","rank":"E"}` | Adds a Lore to the sheet. |
| `grantCantrip` | `{"grantCantrip":{"tradition":"primal"}}` | +1 cantrip pick. |
| `grantFeat` | `{"grantFeat":"shield-block"}` or `"class-1"` / `"general"` | Fixed feat by id, or an extra feat slot of that kind. |
| `grantFocusSpell` | `{"grantFocusSpell":"tempest-surge"}` | Adds a focus spell (define it in `spells` with `"focus": true`). |
| `grantFocusSpellChoice` | `{"grantFocusSpellChoice":["fire-ray","bit-of-luck"]}` | Renders a chooser in the feats step. |
| `focusPoints` | `{"focusPoints":1}` | Grows the focus pool (cap 3). |
| `resist` | `{"resist":{"type":"fire","value":"halfLevel"}}` | Resistance; `"halfLevel"` or a number. |
| `tradition` | `{"tradition":"primal"}` | Resolves a `"patron"` spellcasting tradition (witch pattern). |
| `font` | `{"font":"heal"}` | Cleric divine font: 4 bonus casts of heal at top rank. |
| `special` | `{"special":"hook-id"}` | Activates a coded engine hook — see §8. **Unknown ids are harmless**: they display on the sheet and do nothing. |
| `note` | `{"note":"free text"}` | Sheet note, zero mechanics. |

**Design rule:** prefer composing the declarative effects above. Reach for `special` only when the behavior genuinely needs code, and check §8 first — the hook you want probably exists. If it doesn't, use `note` and write the feat so it still feels worthwhile as flavor + whatever declarative parts you can attach.

## 7. Spells

```json
{ "id": "stone-lance", "name": "Stone Lance", "rank": 1,
  "traditions": ["primal"], "actions": 2, "range": 60,
  "traits": ["earth", "attack"],
  "desc": "Player-facing text.",
  "attackRoll": true,
  "rankEffects": {
    "1": { "damage": [ { "formula": "2d6", "type": "piercing" } ] },
    "2": { "damage": [ { "formula": "3d6", "type": "piercing" } ] }
  } }
```

Resolution model — exactly **one** of these per spell:

* `"attackRoll": true` — spell attack vs AC; crits double and apply `critPersistent` if present. Optional `"maxTargets": 2` (blazing-bolt style: nearest extra targets are included).
* `"save": "reflex" | "fortitude" | "will"` — vs caster DC. Add `"basic": true` for basic-save damage. Condition buckets: `onCritFail` / `onFail` / `onSuccess`, each an array of `{"c":"frightened","v":2,"dur":3}` (`dur` in rounds; omit for standard decrement, `99` = whole fight). `persistent: {"formula":"1","type":"bleed"}` applies on failure.
* `"autoHit": true` — force-barrage style, damage just happens.
* Healing: put `"heal": "1d8+8"` inside the rank entry. `"healOrHarmUndead": true` makes it damage undead (Fort save) — the heal spell pattern. `"tempHP": n` grants temporary HP.
* Buffs: top-level `"selfBuff"`, `"allyBuff"`, or `"partyBuff"` — see core `shield`, `guidance`, `runic-weapon`, `bless`, `courageous-anthem`, `blur` (a `"flag":"blurred"` gives a 20% miss chance), `false-life`, `sure-strike` (`"fortune":"next-attack"`), `resist-energy` (`"resistChoice":5`), and `untamed-claw` (`"grantStrike"`).
* `"utility": true` or `"special": "stabilize"` for the two odd ducks.

Areas: `"area": {"shape":"burst","radius":20}` (pick a point) · `{"shape":"cone","length":15}` / `{"shape":"line","length":30}` (pick a direction) · `{"shape":"emanation","radius":10}` (centered on caster, hits enemies only).

`rankEffects` keys are castable ranks; the engine uses the **highest key ≤ the rank being cast**, so a rank-1 spell with entries at `"1"` and `"2"` heightens automatically when cast from a rank-2 slot. Cantrips (`"rank": 0`) should define `"1"` and `"2"`. Damage/heal numbers should follow Paizo's curves (cantrips ≈ 2 dice at rank 1, +1 die per rank; 2-action heal `1d8+8`/rank).

**Focus spells:** add `"focus": true` (costs 1 focus point). **Hexes:** additionally `"hex": true` — free to cast, limited to one per turn.

## 8. Engine hooks (`special` ids the combat/build engine implements)

`reactive-strike` (fighter reaction on enemy movement) · `bravery` · `sneak-attack` · `surprise-attack` · `deny-advantage` · `racket-thief` · `racket-ruffian` · `racket-scoundrel` · `hunt-prey` · `edge-flurry` · `edge-precision` · `edge-outwit` (partial) · `power-attack` · `sudden-charge` · `exacting-strike` · `intimidating-strike` · `brutish-shove` · `hunted-shot` · `twin-takedown` · `twin-feint` · `nimble-dodge` · `mobility` · `crossbow-ace` (partial) · `cackle` · `witchs-armaments` · `cauldron` · `healing-hands` · `deadly-simplicity` · `emblazon` · `battle-medicine` · `natural-medicine` · `intimidating-glare` · `terrified-retreat` · `assurance` · `shield-block` · `toughness` · `diehard` · `halfling-luck` · `reduce-frightened` · `burn-it` · `ignore-armor-speed` · `font-heal` · `cantrip-expansion` (builder: +2 cantrip picks).

Reusing these on new feats/classes is encouraged (e.g., a new class can carry `{"special":"sneak-attack"}`).

## 9. Items

Weapons: `{"id","name","category":"weapon","prof":"simple|martial|unarmed","hands":1|2,"damage":"1d8","damageType":"slashing","traits":[…],"range":60,"bulk":1,"rogueOk":true}`. Recognized traits: `agile`, `finesse`, `deadly-dX`, `versatile-X`, `propulsive`, `two-hand-dX` (display), `sweep`/`shove`/etc. (display). `rogueOk` marks membership in the "partial martial" list. Every hero's main weapon automatically carries a +1 potency rune (level-3 kit).

Armor: `{"category":"armor","prof":"unarmored|light|medium|heavy","acBonus":n,"dexCap":n,"speedPen":0|5|10}`.
Shields: see `steel-shield`. Consumables: `{"category":"consumable","heal":"2d8+5"}` — currently potions are the only consumable behavior.

## 10. Monsters

```json
{ "id": "hold-breaker", "name": "Hold-Breaker", "level": 4, "boss": true,
  "traits": ["orc","humanoid"], "size": "Large",
  "ac": 21, "hp": 60, "speed": 30, "perception": 11,
  "saves": { "fort": 12, "ref": 8, "will": 9 },
  "immunities": ["fear"], "weaknesses": [ { "type": "fire", "value": 3 } ],
  "resistances": [ { "type": "physical", "value": 2 } ], "slowed": 0,
  "attacks": [ { "name": "Maul", "bonus": 14, "damage": "2d8+6", "damageType": "bludgeoning",
                 "range": 1, "traits": [], "onCrit": [ { "c": "prone", "v": 1 } ] } ],
  "powers": [ { "name": "Rallying Roar", "cost": 2, "cooldown": 3, "type": "aoe",
                "save": "will", "dc": 21, "radius": 3, "damage": "2d6", "damageType": "sonic",
                "onFail": [ { "c": "frightened", "v": 1 } ],
                "flavor": "One line the Chronicle prints when it fires." } ] }
```

* `range` on attacks is in **cells** (5-ft squares): 1 = melee.
* `slowed: 1` = zombie-style 2 actions per turn.
* AI: uses a `power` when off cooldown and ≥2 PCs are in radius; otherwise Strikes adjacent targets (max 2/turn), uses ranged attacks with line of sight, else closes on the nearest hero. `mental` immunity blocks fear/hex-type conditions.
* Balance for a party of 1–3 at level 3: follow Paizo's monster-building numbers for the creature's level (a level 4 boss ≈ AC 21, HP 60, attack +14, DC 21). Use `minParty` in encounters (§11) to scale.

**Companions** (`companions` array) are pre-built allies: flat stat blocks like monsters plus `"initSkill"`, `"subtitle"`, `"desc"`, and optional `"abilities"` (`{"id","name","cost":2,"type":"heal","heal":"2d8+16","range":6,"uses":3,"flavor":"…"}` — `heal` is the only ability type implemented). An attack with `"sneak":"1d6"` deals that as precision damage against off-guard targets.

## 11. Adventures

```json
{ "id": "my-adv", "name": "…", "level": 3, "start": "scene-one",
  "blurb": "Shown on the adventure picker.",
  "companionsOffered": ["aldous", "wren"],
  "scenes": { … }, "encounters": { … } }
```

**Scenes** — the narrative graph:

```json
"scene-one": {
  "kicker": "Act I · Somewhere", "title": "Scene Title",
  "text": ["First paragraph (gets the illuminated drop cap).", "More paragraphs. Light HTML like <em> is allowed."],
  "onEnter": { "flag": "met-someone", "items": ["healing-potion-lesser"] },
  "companionChoice": true,
  "ending": true, "gameover": true,
  "choices": [
    { "text": "Plain link.", "goto": "scene-two" },
    { "text": "Gated link.", "if": "some-flag", "goto": "x" },          // "!flag" negates
    { "text": "One-shot skill check.",
      "check": { "skill": "diplomacy", "altSkill": "intimidation", "dc": 17,
                 "success": "good-scene", "failure": "bad-scene" },
      "once": true, "flagOnce": "tried-it" },
    { "text": "Fight!", "combat": "enc-id", "victory": "after", "defeat": "gameover",
      "combatLabel": "⚔ Battle: The Whatever" }
  ] }
```

* `goto: "END"` returns to the title screen. Mark epilogues `"ending": true` and death `"gameover": true`.
* Checks roll the **hero's** skill (`altSkill` auto-picks whichever modifier is better; `"skill":"perception"` works). DC guidance at level 3: easy 15 · standard 17–18 · hard 20 · very hard 22. Failure should branch somewhere *interesting*, not dead-end — cost HP, a flag, or a harder fight.
* Useful flag tricks the engine honors: setting `"surprise-round"` before a combat makes enemies off-guard and slow to act in round 1; `"fatigued-start"` applies fatigued to the party.

**Encounters** — the tactical maps:

```json
"enc-id": {
  "name": "…", "w": 12, "h": 9,
  "terrain": { "walls": [[0,0],[5,3]], "diff": [[3,1]] },
  "pcStarts": [[1,4],[1,3],[2,4],[1,5]],
  "foes": [
    { "monster": "skeleton-guard", "x": 9, "y": 2 },
    { "monster": "skeleton-guard", "x": 10, "y": 5, "minParty": 2 } ],
  "bossFlags": { "knows-rite": { "applyToBoss": [ { "c": "sickened", "v": 1, "dur": 99 } ],
                                 "log": "Chronicle line when the flag fires." } },
  "intro": "One line of scene-setting printed at battle start." }
```

* Coordinates are 0-indexed `[x, y]`; keep maps ≤ ~16×12. Provide at least 4 `pcStarts`.
* **Scaling:** foes with `"minParty": 2` (or 3) only spawn at that party size. Budget roughly: solo hero ≈ 2 low-level foes + 1 mid; full party of 3 ≈ a Moderate/Severe encounter by Paizo XP budget.
* `bossFlags` keys are story flags; effects hit the first foe whose monster has `"boss": true`.

## 12. Conditions the engine implements

`frightened`, `sickened`, `enfeebled`, `clumsy`, `stunned`, `prone`, `fatigued`, `fleeing`, `off-guard` (situational, incl. flanking on exact-opposite squares), `dying`/`wounded` (heroes), persistent damage, temp HP, plus custom-but-mechanical `bane`, `hexed`, `night-shrouded`, `slowed-feet`, `gripped`. Anything else in a condition bucket will display as a chip and decrement, but won't do math — prefer the list above.

## 13. Known simplifications (don't "fix" these in data)

Prepared casters use per-rank slot pools; divine font is a flat 4; wizard school slots are folded into base slots; shield block auto-triggers; Demoralize takes a −4 language penalty vs. everything unless the hero has Intimidating Glare; victory grants a breather (half of missing HP + focus back); one skill increase at level 3 for every class; exact-opposite-square flanking. The design intent is **correct-feeling PF2e at level 3**, not a rules-complete VTT.

## 14. Workflow for a future Claude

1. Read this guide, then skim `CORE_PACK`/`ADVENTURE_PACK` inside `torchbearer.html` for live examples of anything unclear.
2. Draft the pack. Keep `desc` fields to 1–3 sentences, mechanical text player-facing, and scene paragraphs 2–4 to a scene in the established voice (concrete, wry, a little gothic).
3. Self-check against the validator's rules: every object has `id` + `name` + its required fields; every `goto`/`success`/`failure` points at a real scene; every `combat` points at a real encounter; every referenced feat/spell/monster id exists (in this pack or core).
4. Balance pass: compare every number to a core sibling of the same level (feat vs core feat, monster vs `bell-warden`, DC vs the table in §11).
5. Deliver as a standalone `.json` file. If asked to add new *engine behavior* (a new `special`, condition, or ability type), that requires editing `torchbearer.html` itself — say so rather than inventing schema fields, because unknown fields are silently ignored.
