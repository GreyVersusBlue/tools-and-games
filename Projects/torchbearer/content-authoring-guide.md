# Torchbearer — Content Authoring Guide

**Audience:** a future Claude session (or a careful human) creating JSON content packs for `torchbearer.html`, a single-file Pathfinder 2e adventure engine. Characters are built at **level 3** under Remaster rules. Everything the engine knows — ancestries, backgrounds, classes, feats, spells, items, monsters, companions, and adventures — flows through one loader. The baked-in Player Core content and the baked-in adventure use **exactly the schema described here**, so the source of `torchbearer.html` (constants `CORE_PACK` and `ADVENTURE_PACK`) is always the authoritative worked example. When in doubt, imitate it.

Packs are loaded at runtime two ways: **The Shelf** on the title screen, which lists everything in `Projects/torchbearer/packs/` and loads it in one click, and **Load Content JSON** on the title bar, for a file on your own disk. A pack that fails validation is rejected with a list of errors; nothing is partially loaded.

To put a pack on the Shelf, drop the `.json` in `packs/` and add an entry to `packs/index.json`. `test/smoke.mjs` asserts the manifest's `id`, `name`, `type` and `description` against the pack's own `pack` block, so the two cannot drift.

> **Audited 2026-07-27 (session 8)** against the engine, field by field. Six documented engine hooks turned out to do nothing, one documented effect was never implemented, and one implemented effect was never documented. Everything below now matches the code; the places where the engine is less capable than it reads are called out rather than quietly left in.

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
| `bonus` | `{"bonus":{"target":"speed"\|"hp"\|"initiative","value":n,"type":"status"\|"circumstance"\|"untyped"}}` | Applied numerically at character finalize. A `"vs"` field (e.g. `"vs":"seek"`) demotes it to a displayed note — **but only on `speed`**. A `vs` on `hp` or `initiative` is ignored and the bonus applies flatly. |
| `profUp` | `{"profUp":{"target":"perception"\|"save.fort"\|"save.ref"\|"save.will","rank":"E"}}` | Raises proficiency if higher. Optional `"ifSubclass":"warpriest"` substring-matches the chosen subclass id. `"target":"save.all"` parses but does nothing — list the three saves separately. |
| `attackProf` / `armorProf` | `{"attackProf":{"martial":"T"}}` | Merges weapon/armor proficiencies (also unlocks those items in the gear step). |
| `trainSkill` | `{"trainSkill":"nature"}` or `"choice"` | Fixed training, or +1 skill pick in the builder. |
| `grantLore` | `{"grantLore":"Bardic Lore","rank":"E"}` | Adds a Lore to the sheet. |
| `grantCantrip` | `{"grantCantrip":{"tradition":"primal"}}` | +1 cantrip pick. The `tradition` is **not** read — the pick comes from the class's own list. |
| `grantFeat` | `{"grantFeat":"shield-block"}` or `"class-1"` / `"general"` | Fixed feat by id (the named feat's own `effects` are applied, one level deep — a granted feat's `grantFeat` is not followed), or an extra feat slot of that kind. |
| `sense` | `{"sense":"darkvision"}` | Adds a sense to the sheet. Cosmetic, same as an ancestry's `senses`. |
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
* Healing: put `"heal": "1d8+8"` inside the rank entry. `"healOrHarmUndead": true` makes it damage undead (Fort save) — the heal spell pattern. Its mirror is `"livingOnly": true` plus `"healsUndead": true`, which is how core's void spell hurts the living and heals the undead. `"tempHP": n` grants temporary HP.
* Buffs: top-level `"selfBuff"`, `"allyBuff"`, or `"partyBuff"` — see core `shield`, `guidance`, `runic-weapon`, `bless`, `courageous-anthem`, `blur` (a `"flag":"blurred"` gives a 20% miss chance), `false-life`, `sure-strike` (`"fortune":"next-attack"`), `resist-energy` (`"resistChoice":5`), and `untamed-claw` (`"grantStrike"`).
* `"utility": true` or `"special": "stabilize"` for the two odd ducks.

Areas: `"area": {"shape":"burst","radius":20}` (pick a point) · `{"shape":"cone","length":15}` / `{"shape":"line","length":30}` (pick a direction) · `{"shape":"emanation","radius":10}` (centered on caster, hits enemies only).

`rankEffects` keys are castable ranks; the engine uses the **highest key ≤ the rank being cast**, so a rank-1 spell with entries at `"1"` and `"2"` heightens automatically when cast from a rank-2 slot. Cantrips (`"rank": 0`) should define `"1"` and `"2"`. Damage/heal numbers should follow Paizo's curves (cantrips ≈ 2 dice at rank 1, +1 die per rank; 2-action heal `1d8+8`/rank).

**Focus spells:** add `"focus": true` (costs 1 focus point). **Hexes:** additionally `"hex": true` — free to cast, limited to one per turn.

## 8. Engine hooks (`special` ids the combat/build engine implements)

**These 41 are wired to code.** Reusing them on new feats and classes is encouraged (a new class can carry `{"special":"sneak-attack"}` and it will work):

`reactive-strike` (a reaction on an enemy's move or manipulate, from either side of the board) · `mobility` · `bravery` · `sneak-attack` · `deny-advantage` · `racket-thief` · `racket-ruffian` · `hunt-prey` · `edge-flurry` · `edge-precision` · `power-attack` · `sudden-charge` · `exacting-strike` · `intimidating-strike` · `brutish-shove` · `hunted-shot` · `twin-takedown` · `twin-feint` · `nimble-dodge` · `cackle` · `witchs-armaments` · `cauldron` · `healing-hands` · `deadly-simplicity` · `emblazon` · `natural-medicine` · `intimidating-glare` · `terrified-retreat` · `shield-block` · `toughness` · `diehard` · `halfling-luck` · `reduce-frightened` · `burn-it` · `ignore-armor-speed` · `font-heal` · `assurance` · `surprise-attack` · `edge-outwit` · `racket-scoundrel` · `crossbow-ace`.

Two more work through a different route: `cantrip-expansion` is read by the builder (+2 cantrip picks, never reaches the sheet's `specials`), and `battle-medicine` is checked against `build.feats` by name rather than through `specials` — so putting `{"special":"battle-medicine"}` on a *class feature* does nothing; only the feat with that id works.

**`assurance` is a floor, not a bonus, and only fires on a scene `check`.** `{"special":"assurance","skill":"athletics"}` needs its `skill` field — omitting it (or spelling it inconsistently) leaves the feat inert with no error, same as any other unknown hook. When a scene choice's `c.check.skill` (or `altSkill`, if it resolves higher) matches a skill the hero has Assurance for, `choose()` offers a modal before rolling: forgo the die and take `10 + proficiency bonus` (rank + level, **not** the ability modifier — the same distinction PF2e itself draws), or roll normally. Forgoing always resolves to exactly a success or a failure, never a critical either way, since there is no die to crit on. Perception is deliberately excluded even if a future feat granted it that way, since no core content does and `resolveCheck` has no ability-mod backout for it. Combat's own skill actions (Demoralize, Battle Medicine) do not check for Assurance — no core content grants Assurance for intimidation or medicine today, and wiring it in blind would be guessing at UX for a case nothing exercises.

**`surprise-attack` checks turn order, not a flat round number.** `{"special":"surprise-attack"}` grants off-guard against any target whose slot in `Combat.order` is at or after `Combat.turnIdx` while `Combat.round===1` — i.e. anyone who hasn't had their turn yet this round, re-evaluated fresh on every attack roll rather than latched for the whole round. It stacks with `sneak-attack` exactly like the tabletop rule intends, since both feed the same `offGuard` flag in `strike()`.

**Feint is a new combat verb (session 11), gated on training in Deception.** Any hero with `ch.skills.deception!=="U"` gets a "🎭 Feint" button (1 action, adjacent foe only): Deception vs. the target's Perception DC (`10+t.perception`, no crit-specific extra effect). On success the target is off-guard to the feinter's *next* Strike only, this turn; `racket-scoundrel` widens that to *every* attack the feinter makes for the rest of the turn. The window is tracked per-attacker on the target (`t.feint = {by, round, turnIdx, usesLeft}`), checked and consumed inside `effAC`, and expires the instant the feinter's `turnIdx` changes — nothing needs to clear it explicitly.

**`edge-outwit` is now wired for two of its three checks.** `{"special":"edge-outwit"}` gives +1 circumstance AC in `effAC` when the attacker is the hero's own hunted prey (`Combat.huntPreyId`), plus +2 circumstance on Demoralize and on the new Feint action, both only against that same hunted prey. **Stealth stays unbonused** — there's still no Hide action to attach it to, so a Ranger with this edge gets the AC term and both implemented skill bonuses, and the guide says so rather than silently shipping two-thirds of the feat as if it were the whole thing.

**`racket-scoundrel` is wired through the new Feint action** (previous paragraph) — see there for the exact off-guard window it grants.

**`crossbow-ace` is wired through the new Reload action.** A "🔃 Reload" button (1 action) appears whenever the combatant has a ranged weapon carrying the `reload-1` trait (currently only the Crossbow) and sets a per-turn `reloadedThisTurn` flag, reset at the start of every turn. `strike()` checks `crossbow-ace` against that same trait: if the attacker's target is their hunted prey, **or** they reloaded this turn, the crossbow's damage die becomes `1d10` (from `1d8`) and the hit gets +2 circumstance damage — matching the feat's own "against your hunted prey, or after reloading" wording exactly, rather than shipping only the hunted-prey half. Reloading doesn't gate whether you *can* Strike (a loaded crossbow still fires every turn, same as before this session) — it only unlocks this one feat's bonus, so no other crossbow user's turn economy changes.

**Reactions run on a trigger bus, and `mobility` is wired to it.** `Combat.trigger(name, ctx)` in `js/combat.js` offers a trigger to every combatant in initiative order that still has `reactionUsed === false`, and the reaction resolves *before* the action that triggered it completes. Four triggers exist: `move-out-of-reach` (a Stride that leaves a threatened square), `manipulate` (Drink Potion and Reload), `incoming-damage` (before temporary HP or the HP total sees the number) and `incoming-attack` (before the attack roll is compared to AC). `provokeAlong` no longer refuses a mover that is not a foe, so the hero provokes exactly as a monster does, and reach is read per combatant rather than assumed to be one cell. `mobility` — "your movement at half Speed never provokes reactions" — is decided by the Stride's own path cost against `floor(speed / 2)`, so a short Stride is safe and one square further is not; the Chronicle says so only when the move would otherwise have drawn a reaction.

**A combatant spends one reaction per turn, and the player is asked when the choice is real.** `reactionUsed` is the entire budget and is cleared only at the start of that combatant's own turn. When a combatant carries more than one reaction, `Combat.askReaction(cb, id, ctx)` runs first and a "no" leaves the reaction unspent — the page puts a confirm in front of the player, and the engine's own default is yes so a test sees the bus rather than a stub. A combatant with exactly one reaction is never asked, because there is nothing to weigh it against.

**These are inert.** They appear on core content, they display on the sheet, and no code reads them.

| Hook | On | Status |
|---|---|---|
| `bonus-dmg-vs-large`, `bonus-rest-heal`, `drain-bonded`, `ignore-difficult`, `reach-spell`, `trap-finder`, `widen-spell` | various | Flavour only; never claimed otherwise. |

Unknown ids stay harmless — they render on the sheet and do nothing — so an inert hook is a missing feature, not a bug. But **do not add a `special` to new content expecting behaviour unless it is in the working list above.** Use `note` and the declarative effects instead, and if the behaviour genuinely needs code, say so rather than inventing a hook id (§14 step 5).

## 9. Items

Weapons: `{"id","name","category":"weapon","prof":"simple|martial|unarmed","hands":1|2,"damage":"1d8","damageType":"slashing","traits":[…],"range":60,"bulk":1,"rogueOk":true}`. Recognized traits: `agile`, `finesse`, `deadly-dX`, `versatile-X`, `propulsive`, `two-hand-dX` (display), `sweep`/`shove`/etc. (display). `rogueOk` marks membership in the "partial martial" list. Every hero's main weapon automatically carries a +1 potency rune (level-3 kit).

Armor: `{"category":"armor","prof":"unarmored|light|medium|heavy","acBonus":n,"dexCap":n,"speedPen":0|5|10}`.
Shields: see `steel-shield`. Consumables: `{"category":"consumable","heal":"2d8+5"}` — potions are the only consumable behaviour, and **the `heal` field is read now** (session 10; it wasn't before). Drink Potion pops the most-recently-picked-up potion off the hero's stack and rolls that specific item's `heal` formula, so a Minor (`1d8`) and a Lesser (`2d8+5`) in the same pack heal for different amounts, as their text has always promised. This was a real, reachable bug: Bell of Barrowmoor (the built-in adventure) hands out two Lesser Healing Potions, Thornwake Vigil hands out one, and every one of them used to heal a flat `1d8` regardless — silently shorting the player about 10 HP per potion (`2d8+5` averages ~14, `1d8` averages ~4.5). Write the `heal` value you mean; it now does what it says. A hero's starting two potions are always `healing-potion-minor` (the level-3 kit); anything else has to be granted by an adventure's own `onEnter.items`.

## 10. Monsters

```json
{ "id": "hold-breaker", "name": "Hold-Breaker", "level": 4, "boss": true,
  "traits": ["orc","humanoid"], "size": "Large",
  "ac": 21, "hp": 60, "speed": 30, "perception": 11,
  "reach": 2, "reactions": ["reactive-strike"],
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
* `reach` is in **cells** too and defaults to 1 — the eight squares around the creature. A Large creature with `"reach": 2` threatens the ring outside that, and its Reactive Strike fires when a hero leaves it.
* `reactions` names reaction ids from §8's bus: `reactive-strike`, `shield-block`, `nimble-dodge`. **The validator rejects any other id**, the same way it rejects an unknown monster id in an encounter, because a reaction the engine does not implement is a monster that silently never reacts. Omit the field for a creature with no reaction; the shipped Forge-Tyrant in `packs/embers-of-the-hold.json` is the worked example of one carrying both fields.
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

Prepared casters use per-rank slot pools; divine font is a flat 4; wizard school slots are folded into base slots; a combatant gets one reaction per turn and the first trigger it qualifies for takes it, with no Ready and no delayed reactions; Demoralize takes a −4 language penalty vs. everything unless the hero has Intimidating Glare; victory grants a breather (half of missing HP + focus back); one skill increase at level 3 for every class; exact-opposite-square flanking. The design intent is **correct-feeling PF2e at level 3**, not a rules-complete VTT.

## 14. Workflow for a future Claude

1. Read this guide, then skim `CORE_PACK`/`ADVENTURE_PACK` inside `torchbearer.html` for live examples of anything unclear.
2. Draft the pack. Keep `desc` fields to 1–3 sentences, mechanical text player-facing, and scene paragraphs 2–4 to a scene in the established voice (concrete, wry, a little gothic).
3. Self-check against the validator. It lives in `Projects/torchbearer/js/registry.js` and this is everything it enforces — anything not on this list is your problem, not its:
   * every object has an `id` and a `name`, plus the required fields listed per collection in §§2–10;
   * an adventure's `start` names a scene that exists;
   * every scene has a `title` and a `text` array (the engine calls `sc.text.map` with no guard);
   * every `goto`, `check.success`, `check.failure`, `victory` and `defeat` names a real scene, or `"END"`;
   * every `combat` names a real encounter;
   * every encounter foe names a monster that exists, in this pack **or already loaded**;
   * every `companionsOffered` id names a companion that exists;
   * a background's `feat` names a feat that exists.

   It does **not** check spell ids, item ids, `grantFeat` targets, `grantFocusSpell` targets, coordinates inside the map, or whether your numbers are sane. Those are step 4.
4. Balance pass: compare every number to a core sibling of the same level (feat vs core feat, monster vs `bell-warden`, DC vs the table in §11).
5. Deliver as a standalone `.json` file in `Projects/torchbearer/packs/`, and add it to `packs/index.json` so it appears on the Shelf. Run `node Projects/torchbearer/test/smoke.mjs` — it validates every pack in that folder against core and checks the manifest matches. If asked to add new *engine behavior* (a new `special`, condition, or ability type), that requires editing `torchbearer.html` itself — say so rather than inventing schema fields, because unknown fields are silently ignored.
