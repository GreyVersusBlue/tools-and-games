# Torchbearer — Content Authoring Guide

**Audience:** a future Claude session (or a careful human) creating JSON content packs for `torchbearer.html`, a single-file Pathfinder 2e adventure engine. Characters are forged at **level 3** under Remaster rules and level as far as 10 (Phase 6: `build.level` is the hero's, and the Player Core's advancement tables in `rules.js` say what each level grants). Everything the engine knows — ancestries, backgrounds, classes, feats, spells, items, monsters, companions, and adventures — flows through one loader. The baked-in Player Core content and the baked-in adventure use **exactly the schema described here**, so the source of `torchbearer.html` (constants `CORE_PACK` and `ADVENTURE_PACK`) is always the authoritative worked example. When in doubt, imitate it.

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
  "spells": [], "items": [], "monsters": [], "companions": [], "adventures": [], "campaigns": []
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
* A feature fires once the hero's level reaches its `level` — a new hero is forged at 3, and Phase 6 lets one climb to 10, so a level-5 feature is real content now. Features are display-only unless they carry `effects` or a `special` (engine hook — see §8).
* `featLevels` lists the levels at which the class gains a feat of each type. A list is authoritative up to its highest entry and the Player Core's standard table (`FEAT_LEVELS` in `js/rules.js`: class feats at 1, 2, then every even level; skill feats at every even level; general at 3, 7, 11 …; ancestry at 1, 5, 9 …) takes over above it — so `"class":[1,2]` means the standard class-feat row, and the rogue spells its skill-feat list out to 20 because its row is every level. `skillIncreases` (optional) works the same way against the standard 3, 5, 7 … row; the rogue is the one core class that carries it.

**Spellcasting block** (omit or `null` for martials):

```json
"spellcasting": {
  "tradition": "arcane",          // arcane | divine | occult | primal | "patron" (resolved by subclass "tradition" effect)
  "type": "prepared",             // or "spontaneous"
  "ability": "int",
  "cantrips": 5,                  // number of cantrip picks
  "slots": { "1": 3, "2": 2 },    // castable slots per rank at level 3; rules.js moves this row by the Player Core table at other levels (3/3 from level 4)
  "repertoire": { "1": 4, "2": 2 },  // spontaneous only: spells known per rank
  "grantCantrips": ["courageous-anthem"]  // auto-known, on top of picks
}
```

The engine treats slots as a per-rank pool (prepared casting is simplified to "your list + a pool"), and runs ranks 1 and 2 only — a level-5 caster's rank-3 slots do not exist yet. Cantrips auto-heighten to rank ⌈level/2⌉, which is 2 for a new hero.

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
| `bonus` | `{"bonus":{"target":"speed"\|"hp"\|"initiative","value":n,"type":"status"\|"circumstance"\|"untyped"}}` | Applied numerically at character finalize. A `"vs"` field (e.g. `"vs":"seek"`) keeps it off the flat number — **but only on `speed`**; a `vs` on `hp` or `initiative` is still added flatly. Every bonus carrying a `vs`, whatever its target, is also collected onto the sheet as `condBonuses`, where a check site that knows that condition can read it. **Two sites do today:** Seek reads `{"target":"perception","vs":"seek"}`, and every saving throw reads `{"target":"save.all","vs":X}` when `X` is one of the traits the save is against — a spell's save carries `magic` plus the spell's own traits, a monster power's carries the power's. Anything else is collected and unread — a note with a data shape, not a behaviour. |
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

**These 45 are wired to code.** Reusing them on new feats and classes is encouraged (a new class can carry `{"special":"sneak-attack"}` and it will work):

`reactive-strike` (a reaction on an enemy's move or manipulate, from either side of the board) · `mobility` · `bravery` · `sneak-attack` · `deny-advantage` · `racket-thief` · `racket-ruffian` · `hunt-prey` · `edge-flurry` · `edge-precision` · `power-attack` · `sudden-charge` · `exacting-strike` · `intimidating-strike` · `brutish-shove` · `hunted-shot` · `twin-takedown` · `twin-feint` · `nimble-dodge` · `cackle` · `witchs-armaments` · `cauldron` · `healing-hands` · `deadly-simplicity` · `emblazon` · `natural-medicine` · `intimidating-glare` · `terrified-retreat` · `shield-block` · `toughness` · `diehard` · `halfling-luck` · `reduce-frightened` · `burn-it` · `ignore-armor-speed` · `font-heal` · `assurance` · `surprise-attack` · `edge-outwit` · `racket-scoundrel` · `crossbow-ace` · `distracting-shadows` · `titan-wrestler` · `bonus-dmg-vs-large` · `cooperative-nature`.

Two more work through a different route: `cantrip-expansion` is read by the builder (+2 cantrip picks, never reaches the sheet's `specials`), and `battle-medicine` is checked against `build.feats` by name rather than through `specials` — so putting `{"special":"battle-medicine"}` on a *class feature* does nothing; only the feat with that id works.

**`assurance` is a floor, not a bonus, and only fires on a scene `check`.** `{"special":"assurance","skill":"athletics"}` needs its `skill` field — omitting it (or spelling it inconsistently) leaves the feat inert with no error, same as any other unknown hook. When a scene choice's `c.check.skill` (or `altSkill`, if it resolves higher) matches a skill the hero has Assurance for, `choose()` offers a modal before rolling: forgo the die and take `10 + proficiency bonus` (rank + level, **not** the ability modifier — the same distinction PF2e itself draws), or roll normally. Forgoing always resolves to exactly a success or a failure, never a critical either way, since there is no die to crit on. Perception is deliberately excluded even if a future feat granted it that way, since no core content does and `resolveCheck` has no ability-mod backout for it. Combat's own skill actions (Demoralize, Battle Medicine) do not check for Assurance — no core content grants Assurance for intimidation or medicine today, and wiring it in blind would be guessing at UX for a case nothing exercises.

**`surprise-attack` checks turn order, not a flat round number.** `{"special":"surprise-attack"}` grants off-guard against any target whose slot in `Combat.order` is at or after `Combat.turnIdx` while `Combat.round===1` — i.e. anyone who hasn't had their turn yet this round, re-evaluated fresh on every attack roll rather than latched for the whole round. It stacks with `sneak-attack` exactly like the tabletop rule intends, since both feed the same `offGuard` flag in `strike()`.

**Feint is a new combat verb (session 11), gated on training in Deception.** Any hero with `ch.skills.deception!=="U"` gets a "🎭 Feint" button (1 action, adjacent foe only): Deception vs. the target's Perception DC (`10+t.perception`, no crit-specific extra effect). On success the target is off-guard to the feinter's *next* Strike only, this turn; `racket-scoundrel` widens that to *every* attack the feinter makes for the rest of the turn. The window is tracked per-attacker on the target (`t.feint = {by, round, turnIdx, usesLeft}`), checked and consumed inside `effAC`, and expires the instant the feinter's `turnIdx` changes — nothing needs to clear it explicitly.

**`edge-outwit` is wired for all three of its checks.** `{"special":"edge-outwit"}` gives +1 circumstance AC in `effAC` when the attacker is the hero's own hunted prey (`Combat.huntPreyId`), plus +2 circumstance on Demoralize, on Feint, and — since Phase 4 gave it somewhere to go — on Hide. The Hide bonus lands on the comparison against the hunted prey alone, not on the roll: one Stealth die is rolled and shown, and the prey's Perception DC is the only one it is measured against with +2 on top. A Ranger with this edge now gets the whole feat.

**`racket-scoundrel` is wired through the new Feint action** (previous paragraph) — see there for the exact off-guard window it grants.

**`crossbow-ace` is wired through the new Reload action.** A "🔃 Reload" button (1 action) appears whenever the combatant has a ranged weapon carrying the `reload-1` trait (currently only the Crossbow) and sets a per-turn `reloadedThisTurn` flag, reset at the start of every turn. `strike()` checks `crossbow-ace` against that same trait: if the attacker's target is their hunted prey, **or** they reloaded this turn, the crossbow's damage die becomes `1d10` (from `1d8`) and the hit gets +2 circumstance damage — matching the feat's own "against your hunted prey, or after reloading" wording exactly, rather than shipping only the hunted-prey half. Reloading doesn't gate whether you *can* Strike (a loaded crossbow still fires every turn, same as before this session) — it only unlocks this one feat's bonus, so no other crossbow user's turn economy changes.

**Reactions run on a trigger bus, and `mobility` is wired to it.** `Combat.trigger(name, ctx)` in `js/combat.js` offers a trigger to every combatant in initiative order that still has `reactionUsed === false`, and the reaction resolves *before* the action that triggered it completes. Four triggers exist: `move-out-of-reach` (a Stride that leaves a threatened square), `manipulate` (Drink Potion and Reload), `incoming-damage` (before temporary HP or the HP total sees the number) and `incoming-attack` (before the attack roll is compared to AC). `provokeAlong` no longer refuses a mover that is not a foe, so the hero provokes exactly as a monster does, and reach is read per combatant rather than assumed to be one cell. `mobility` — "your movement at half Speed never provokes reactions" — is decided by the Stride's own path cost against `floor(speed / 2)`, so a short Stride is safe and one square further is not; the Chronicle says so only when the move would otherwise have drawn a reaction.

**A combatant spends one reaction per turn, and the player is asked when the choice is real.** `reactionUsed` is the entire budget and is cleared only at the start of that combatant's own turn. When a combatant carries more than one reaction, `Combat.askReaction(cb, id, ctx)` runs first and a "no" leaves the reaction unspent — the page puts a confirm in front of the player, and the engine's own default is yes so a test sees the bus rather than a stub. A combatant with exactly one reaction is never asked, because there is nothing to weigh it against.

**Detection is a per-pair state, and four actions read it.** `Combat.detect[observerId][targetId]` holds `"concealed"`, `"hidden"` or `"undetected"`, and its absence means "whatever the target's own conditions say" — the `concealed` condition reads as concealed to everyone, `invisible` as undetected, and everything else as observed. Concealed forces a DC 5 flat check before a Strike, a targeted spell or a monster's attack resolves; hidden forces DC 11; undetected cannot be targeted at all, by the player's action bar or by the AI. A failed flat check spends the action and raises the MAP: the swing happened, it just found empty air.

The four actions are **Hide** (one action, one Stealth roll compared against each foe's Perception DC separately — it is not a targeted action, because the tabletop action is one check against every observer at once), **Seek** (one action, one Perception roll against the Stealth DC of everything hidden in a 15-foot burst you pick within 30 feet; a found creature becomes observed, and a found *invisible* one only becomes hidden), **Take Cover** (one action, +2 AC, needs a wall in one of the eight squares around you, and ends the moment you move or Strike), and the monster AI's own Seek, which it spends an action on when every hero has gone undetected. **Hiding survives nothing.** A hidden creature that moves or attacks drops every "hidden" naming it and falls back to whatever its conditions say — concealed if it is concealed, undetected if it is invisible, observed otherwise.

**Cover comes off geometry, not off a flag.** `Combat.coverBonus(a, b)` walks the same Bresenham line `losClear` does and reads what it steps over: a wall is greater cover (+4 AC), a living body is lesser cover (+2), and the greater wins, because circumstance bonuses do not stack — Take Cover behind a wall is +4, not +6. Neither endpoint's own square is read, so a caster standing on a wall is not its own cover. Hiding needs greater cover or concealment; lesser cover is not enough **unless** the hero has `distracting-shadows`, whose text is "using Medium and larger creatures as cover to Hide" and which is a wired hook as of Phase 4. `very-sneaky` stays a note: it is about Sneak, and there is no Sneak action.

**The rest of the action economy landed in Phase 5, and it is nine actions.** Four are Athletics maneuvers — **Trip**, **Shove**, **Grapple** and **Disarm** — each one action, each an Athletics check against `10 + the target's own save modifier` for the save named below, and each carrying the attack trait, so it takes the MAP already on the actor and raises it afterwards exactly as a Strike does. That DC is the plain PF2e formula and deliberately not Demoralize's `10 + save + level`; Feint and Hide already use the plain form against Perception, so Demoralize is the one out of step and changing it is a balance change to every fight in the game.

| Action | DC off | Success | Critical success | Critical failure |
|---|---|---|---|---|
| Trip | Reflex | `prone` | `prone` + 1d6 bludgeoning | you fall `prone` |
| Shove | Fortitude | driven back 1 square | driven back 2 | — |
| Grapple | Fortitude | `grabbed` | `grabbed` (a higher total, so a harder Escape) | you fall `prone` |
| Disarm | Reflex | `disarmed 1` (−2 to its Strikes, 2 rounds) | the same, plus one action next turn to pick the weapon up | — |

The push is a straight line directly away from the shover; it stops at a wall, an edge or an occupied square, and it **provokes nothing**, because being Shoved is not a Stride. It still counts as moving for Take Cover and for hiding. `grabbed` is immobilized plus off-guard: **Escape** (one action, the better of Athletics and Acrobatics, also attack-trait) is rolled against the total that made the grab — the same shape Phase 4's `hideDC` uses, and not PF2e's "the grabber's Class DC", which is why a critical Grapple is harder to break without needing a second condition value to carry the difference. A grip ends on its own when the grabber dies or walks away from it. **Stand** (one action) is the other half of Trip, and had to exist: before Phase 5 nothing anywhere in the engine removed `prone`.

**Size is read now, on both sides of a maneuver.** A hero's comes off the sheet (`rules.js` puts the ancestry's `size` there), a monster's off its Registry entry, and anything naming none is Medium. A maneuver reaches one size larger than the actor; `titan-wrestler` — "you can Disarm, Grapple, Shove, or Trip creatures up to two sizes larger than you", a note until now — makes it exactly two and nothing more. A maneuver against something too big costs no action and leaves the button armed, the same way an out-of-range Strike does. `bonus-dmg-vs-large` is wired off the same field: +1 circumstance damage against anything Large or bigger, which is what Mountain Strategy and Titan Slinger have promised since they shipped. **Brutish Shove's second half is real too** — "and you may Shove it" is the free Shove the feat's text describes, rolled off the Strike that already hit rather than a second check.

**Aid is the only action that outlives the turn that spent it.** One action, an adjacent ally (never yourself), and nothing is rolled yet: the preparation is remembered on both ends and the die comes out at the moment the ally's next check does. That check can be a Strike, an Athletics maneuver, an Escape, Demoralize, Feint, Battle Medicine or Recall Knowledge. The aider rolls **Athletics against a flat DC 15** whatever the ally is doing — the engine cannot know which skill the ally's next check will use, so one number stands for lending a hand — and a critical success is +2, a success +1, a critical failure −1. `cooperative-nature`'s +4 lands on that roll and is the whole of the feat. An Aid nobody used is dropped at the start of the aider's next turn.

**Recall Knowledge prints a line of stat block.** One action, a foe within 30 feet, and a check against the GM Core's level-based DC for that creature's level (`14 + level + floor(level / 3)`, and 13 at level −1). The skill comes off the creature's first trait that names one — undead and spirits are Religion, beasts and fey are Nature, humanoids and giants are Society, constructs are Crafting, elementals and dragons are Arcana, and anything nobody has a word for is Occultism. A success prints AC and current HP; a critical success adds the three saves, every weakness, resistance and immunity, and the monster's own optional **`"lore"`** string. Asking twice about the same creature is +2 DC per attempt already made.

**Delay is a move within the initiative order, and Ready is one Strike on the bus.** Delay costs nothing, splices the combatant out of `Combat.order` and pushes it onto the end, and **ticks nothing** — the turn has not happened, so conditions come off when the delayed turn ends like anybody else's. Once per round, because two Delays in a round is a combatant that never has to act, and a combatant already last simply ends its turn. Ready costs **two** actions and arms one Strike against the same `move-out-of-reach` trigger a Reactive Strike answers, read the other way round: it fires when an enemy steps *into* reach rather than out of it. A readied action is not a feat — it is not in `REACTIONS`, the validator does not know the word, and a monster's `"reactions"` field cannot name it — but it spends the same one reaction per turn everything else does and is dropped at the start of the readier's next turn, fired or not.

**These are inert.** They appear on core content, they display on the sheet, and no code reads them.

| Hook | On | Status |
|---|---|---|
| `bonus-rest-heal`, `drain-bonded`, `ignore-difficult`, `reach-spell`, `trap-finder`, `widen-spell` | various | Flavour only; never claimed otherwise. |

Unknown ids stay harmless — they render on the sheet and do nothing — so an inert hook is a missing feature, not a bug. But **do not add a `special` to new content expecting behaviour unless it is in the working list above.** Use `note` and the declarative effects instead, and if the behaviour genuinely needs code, say so rather than inventing a hook id (§14 step 5).

## 9. Items

Weapons: `{"id","name","category":"weapon","prof":"simple|martial|unarmed","hands":1|2,"damage":"1d8","damageType":"slashing","traits":[…],"range":60,"bulk":1,"rogueOk":true}`. Recognized traits: `agile`, `finesse`, `deadly-dX`, `versatile-X`, `propulsive`, `two-hand-dX` (display), `sweep`/`shove`/etc. (display). `rogueOk` marks membership in the "partial martial" list. Every hero's main weapon automatically carries a +1 potency rune (level-3 kit).

Armor: `{"category":"armor","prof":"unarmored|light|medium|heavy","acBonus":n,"dexCap":n,"speedPen":0|5|10}`.
Shields: see `steel-shield`. Consumables: `{"category":"consumable","heal":"2d8+5"}` — potions are the only consumable behaviour, and **the `heal` field is read now** (session 10; it wasn't before). Drink Potion pops the most-recently-picked-up potion off the hero's stack and rolls that specific item's `heal` formula, so a Minor (`1d8`) and a Lesser (`2d8+5`) in the same pack heal for different amounts, as their text has always promised. This was a real, reachable bug: Bell of Barrowmoor (the built-in adventure) hands out two Lesser Healing Potions, Thornwake Vigil hands out one, and every one of them used to heal a flat `1d8` regardless — silently shorting the player about 10 HP per potion (`2d8+5` averages ~14, `1d8` averages ~4.5). Write the `heal` value you mean; it now does what it says. A hero's starting two potions are always `healing-potion-minor` (the level-3 kit); anything else has to be granted by an adventure's own `onEnter.items`.

## 10. Monsters

```json
{ "id": "hold-breaker", "name": "Hold-Breaker", "level": 4, "boss": true,
  "traits": ["orc","humanoid"], "size": "Large",
  "lore": "One line a critical Recall Knowledge prints. Optional.",
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
* `size` is one of `Tiny`, `Small`, `Medium`, `Large`, `Huge`, `Gargantuan`, and defaults to Medium. **The validator rejects anything else**, because a misspelling reads as Medium and quietly makes a Gargantuan creature wrestleable. It decides which Athletics maneuvers can reach the creature (one size larger than the hero, or two with Titan Wrestler) and whether `bonus-dmg-vs-large` fires.
* `lore` is one optional string: the line a **critical** Recall Knowledge prints, after the saves and the weaknesses. Write the thing a player could act on — how it hunts, where it is brittle, what it will not do — not a second `desc`. All six core monsters carry one.
* `traits` decide which skill a Recall Knowledge check about the creature uses (§8), so the first trait that names a skill is worth putting first.
* `slowed: 1` = zombie-style 2 actions per turn.
* AI: uses a `power` when off cooldown and ≥2 PCs are in radius; otherwise Strikes adjacent targets (max 2/turn), uses ranged attacks with line of sight, else closes on the nearest hero. `mental` immunity blocks fear/hex-type conditions.
* Balance for a party of 1–3 at level 3: follow Paizo's monster-building numbers for the creature's level (a level 4 boss ≈ AC 21, HP 60, attack +14, DC 21). Use `minParty` in encounters (§11) to scale.

**Companions** (`companions` array) are pre-built allies: flat stat blocks like monsters plus `"initSkill"`, `"subtitle"`, `"desc"`, and optional `"abilities"` (`{"id","name","cost":2,"type":"heal","heal":"2d8+16","range":6,"uses":3,"flavor":"…"}` — `heal` is the only ability type implemented). An attack with `"sneak":"1d6"` deals that as precision damage against off-guard targets.

## 11. Adventures

```json
{ "id": "my-adv", "name": "…", "level": 3, "start": "scene-one",
  "blurb": "Shown on the adventure picker.",
  "companionsOffered": ["aldous", "wren"],
  "awards": { "enc-id": 80, "ending": 120 },
  "scenes": { … }, "encounters": { … } }
```

* **`awards`** (optional) is the experience the adventure pays toward the hero's next level, in whole XP: one entry per encounter id, credited when that fight is won, and one under `"ending"`, credited the first time the hero reaches a scene marked `"ending": true` (a `"gameover"` scene pays nothing). Each key pays once per playthrough. A level is 1,000 XP, PF2e's flat rate, and the counter starts over at the new level. **Leave `awards` out and the adventure is a milestone: its ending is worth a whole level and its fights nothing** — every shipped adventure is a one-shot and works this way. An empty `{}` pays nothing at all. A key naming no encounter of this adventure is rejected by the validator.

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
* Checks roll the **hero's** skill (`altSkill` auto-picks whichever modifier is better; `"skill":"perception"` works). DC guidance at level 3: easy 15 · standard 17–18 · hard 20 · very hard 22. The GM Core's level-based DC is `14 + level + floor(level / 3)` (`levelDC` in `rules.js`): 18 at 3, 19 at 4, 20 at 5, 22 at 6, 23 at 7, 24 at 8, 26 at 9, 27 at 10 — an adventure's `level` field says which row its DCs were written against, and a hero two levels above it will find them easy. Failure should branch somewhere *interesting*, not dead-end — cost HP, a flag, or a harder fight.
* Useful flag tricks the engine honors: setting `"surprise-round"` before a combat makes enemies off-guard and slow to act in round 1; `"fatigued-start"` applies fatigued to the party.

**Encounters** — the tactical maps:

```json
"enc-id": {
  "name": "…", "w": 12, "h": 9,
  "terrain": { "walls": [[0,0],[5,3]], "diff": [[3,1]] },
  "pcStarts": [[1,4],[1,3],[2,4],[1,5]],
  "foes": [
    { "monster": "skeleton-guard", "x": 9, "y": 2 },
    { "monster": "skeleton-guard", "x": 10, "y": 5, "minParty": 2 },
    { "monster": "skeletal-champion", "x": 11, "y": 5, "minLevel": 5 },
    { "monster": "moor-hound", "x": 3, "y": 6, "maxLevel": 4 } ],
  "bossFlags": { "knows-rite": { "applyToBoss": [ { "c": "sickened", "v": 1, "dur": 99 } ],
                                 "log": "Chronicle line when the flag fires." } },
  "intro": "One line of scene-setting printed at battle start." }
```

* Coordinates are 0-indexed `[x, y]`; keep maps ≤ ~16×12. Provide at least 4 `pcStarts`.
* **Scaling:** foes with `"minParty": 2` (or 3) only spawn at that party size; foes with `"minLevel"` or `"maxLevel"` only spawn when the hero's level is inside the range (both bounds inclusive, either alone is fine). All three are whole numbers of 1 or more, and a `minLevel` above its `maxLevel` is rejected. Budget roughly: solo hero ≈ 2 low-level foes + 1 mid; full party of 3 ≈ a Moderate/Severe encounter by Paizo XP budget. A hero who has played the three shipped one-shots is level 6 and will walk through a level-3 encounter unless something is gated on `minLevel`.
* `bossFlags` keys are story flags; effects hit the first foe whose monster has `"boss": true`.

**Campaigns** — a run of adventures, in order:

```json
"campaigns": [
  { "id": "bell-and-bridge", "name": "The Bell and the Bridge", "level": 3,
    "blurb": "Shown on the picker and at the top of the campaign board.",
    "adventures": [
      { "adventure": "barrowmoor" },
      { "adventure": "thornwake",
        "if": "barrowmoor/bell-answered",
        "locked": "The bell over Barrowmoor is still ringing." } ] } ]
```

* An entry is always an **object**, never a bare id string, so it has somewhere to put an `if` and a `locked` line. `adventure` names an adventure defined in this pack or already loaded. The same adventure twice in one campaign is rejected: "finished" could not mean one of them.
* `level` is the level the campaign is written for, shown on its card. It sets nothing — the hero is whatever level they are.
* **Flags have two scopes, and one grammar.** `"met-maud"` is the *running adventure's* flag, in the flat map that starts empty every time an adventure begins and dies with it. `"barrowmoor/met-maud"` is the *campaign record's*, written when Barrowmoor ended. Anywhere the engine takes a flag expression — a scene choice's `"if"`, a campaign entry's `"if"` — a name with a `/` reads the record and a name without one reads the running adventure. A leading `!` negates either. So two adventures can both use `knows-name` and never collide, and an adventure in a campaign can offer a choice only a hero who did something forty miles ago can see.
* **What gets folded into the record.** When an adventure reaches a scene marked `"ending": true` that is not a `"gameover"`, every flag it set is copied into the record as `<adventure-id>/<flag>` and its id joins the finished list. The `awarded:` keys the XP bookkeeping writes are dropped — they are one run's accounting, not a story fact. Dying folds nothing, so a gameover leaves the road exactly as it was.
* **A gate must be provable.** `"if"` on a campaign entry has to be scoped, has to name an adventure this campaign lists *earlier*, and has to name a flag that adventure's own scenes can actually set (an `onEnter.flag` or a choice's `flagOnce`). All three are validator errors, because a gate that can never open is a road the player can see and never walk, and the only symptom is a card that stays locked forever. Write the `locked` line as the reason, in the player's language.
* Give every ending that is not a death the flag your next entry gates on, or a player who finished the first adventure the "wrong" way is stranded. The Bell of Barrowmoor sets `bell-answered` on all three of its real endings for exactly this reason.
* The save carries `campaignId`, the folded `campaignFlags` and the finished `completed` list. It holds **one** campaign at a time: starting a different campaign, or picking a one-shot off the picker, forgets the record after a confirmation.

## 12. Conditions the engine implements

`frightened`, `sickened`, `enfeebled`, `clumsy`, `stunned`, `prone`, `fatigued`, `fleeing`, `off-guard` (situational, incl. flanking on exact-opposite squares), `concealed`, `invisible`, `grabbed`, `disarmed`, `dying`/`wounded` (heroes), persistent damage, temp HP, plus custom-but-mechanical `bane`, `hexed`, `night-shrouded`, `slowed-feet`, `gripped`.

`grabbed` and `disarmed` are Phase 5's. `grabbed` is immobilized plus off-guard, comes with a `grabDC` on the same combatant, and is the only condition removed by an action of its own (Escape). `disarmed` is −2 per value on everything the creature swings; the engine has one weapon per attack entry and no way to say "that one", so it is −2 on all of them. `prone` was implemented before Phase 5 and could not be applied by anything, and nothing removed it; Trip applies it and Stand takes it off. Anything else in a condition bucket will display as a chip and decrement, but won't do math — prefer the list above.

`concealed` and `invisible` are the two Phase 4 added, and they are the base of the detection state described in §8: `{"c":"concealed","v":1,"dur":3}` on a spell's `onFail` bucket makes the target cost every attacker a DC 5 flat check for three rounds, and `invisible` makes it untargetable until somebody Seeks it into being merely hidden. Both are ordinary conditions — they chip, they decrement, they come off a `dur` like anything else.

## 13. Known simplifications (don't "fix" these in data)

Prepared casters use per-rank slot pools; divine font is a flat 4; wizard school slots are folded into base slots; a combatant gets one reaction per turn and the first trigger it qualifies for takes it, and Ready arms exactly one thing — a Strike against a foe entering reach — rather than an arbitrary action against an arbitrary trigger; Aid rolls Athletics against a flat DC 15 whatever it is aiding, because the engine cannot know the skill the ally's next check will use; Grapple's Escape DC is the total that made the grab rather than the grabber's Class DC; Disarm's −2 lands on every attack the target has rather than on the weapon it was aimed at, and PF2e's `restrained` is not modelled — a critical Grapple is an ordinary grab with a higher DC; only heroes use Athletics maneuvers, because no monster in the game carries an Athletics number; Rock Dwarf's "+2 DC vs Shove/Trip/prone" therefore stays a note, since nothing can Shove or Trip a hero; there is no Sneak, so a hidden creature that moves is simply seen again; cover is read off the line to the attacker and never off a corner rule; only heroes Hide, because no monster in the game carries a Stealth number to Hide with; Demoralize takes a −4 language penalty vs. everything unless the hero has Intimidating Glare; victory grants a breather (half of missing HP + focus back); taking a level is a rest too (HP and pools refill; potions and the wounded value carry over); the kit's runes follow the level rather than gold — +1 potency from 2nd, striking from 4th, +2 potency from 10th, on every weapon the hero carries and on nothing a companion does; spell ranks stop at 2, so a caster's rank-2 slots grow to 3 at 4th and nothing grows after that, and no level-up step touches the spell list; every level-up feat slot draws on the loaded feats at or below its level, and the core pack's feats stop at 2nd, so a slot with nothing left to offer is left empty rather than blocking the level; XP is PF2e's flat 1,000 a level with no per-encounter budget arithmetic — an adventure pays what its `awards` say or a level at its ending; the level stops at 10; exact-opposite-square flanking; a save holds one campaign record, so a second campaign forgets the first; a campaign gate is one flag expression with a `!` and no `and`/`or`, so "either ending opens this" is written by giving both endings the same flag rather than by a bigger grammar; and a campaign carries flags between its adventures and nothing else yet — no gold, no shop, no downtime, and no treasure that survives an ending. The design intent is **correct-feeling PF2e from level 3 to 10**, not a rules-complete VTT.

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
   * a campaign's entries are objects naming adventures that exist, no adventure listed twice, and every `"if"` scoped to an adventure listed earlier and to a flag that adventure can actually set;
   * every `companionsOffered` id names a companion that exists;
   * a background's `feat` names a feat that exists.

   It does **not** check spell ids, item ids, `grantFeat` targets, `grantFocusSpell` targets, coordinates inside the map, or whether your numbers are sane. Those are step 4.
4. Balance pass: compare every number to a core sibling of the same level (feat vs core feat, monster vs `bell-warden`, DC vs the table in §11).
5. Deliver as a standalone `.json` file in `Projects/torchbearer/packs/`, and add it to `packs/index.json` so it appears on the Shelf. Run `node Projects/torchbearer/test/smoke.mjs` — it validates every pack in that folder against core and checks the manifest matches. If asked to add new *engine behavior* (a new `special`, condition, or ability type), that requires editing `torchbearer.html` itself — say so rather than inventing schema fields, because unknown fields are silently ignored.
