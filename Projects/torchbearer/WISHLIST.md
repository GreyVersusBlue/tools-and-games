# Torchbearer — Feature Wishlist

**Status: Phase 5 shipped.** Arc one is finished. The action bar is nine
actions longer: Trip, Shove, Grapple, Disarm, Escape, Stand, Aid, Recall
Knowledge, Delay and Ready. `size` is read on both sides of a maneuver, which
turned `titan-wrestler` and `bonus-dmg-vs-large` from note text into working
hooks; `cooperative-nature`'s +4 is the third. Saves read conditional `bonus`
entries off the sheet by trait, so Ancient-Blooded Dwarf and Gutsy Halfling do
something for the first time. `prone` could be applied by nothing and removed
by nothing before this phase, and now Trip applies it and Stand takes it off.
`node Projects/torchbearer/test/smoke.mjs` is green at **1,439 passed, 0
failed**, up from 947 — and it runs in CI, on
`.github/workflows/torchbearer-ci.yml`. **Phase 6 — A hero who levels** has
shipped in two increments: level is a field on the build, every derived
number hangs off it, the progression tables are data with checks on them,
the save is at version 3, and a hero with 1,000 XP banked takes the next
level from the title screen through a second mode of the builder. An
adventure pays XP through `awards`, or a whole level at its ending when it
declares none. Foes scale by `minLevel`/`maxLevel` beside `minParty`, the
kit's runes follow the level, and guide §13 now promises "correct-feeling
PF2e from level 3 to 10". **Phase 7 — The campaign spine has shipped, in
three increments.** `campaigns` is a pack collection, "The Bell and the
Bridge" runs Barrowmoor into Thornwake behind a gate the validator proves can
open, and a save carries `campaignId`, `campaignFlags`, `completed`, the
`gold` in the purse, the `inventory` in the pack and the `days` spent between
roads. Money is counted in copper everywhere; `"kind": "shop"` and
`"kind": "explore"` are the two scene kinds; the state a fight opens in is a
five-entry table instead of two hardcoded flags; there is a camp between the
roads with a long rest, Treat Wounds, Earn Income and a Crafting bench in it;
and an unreachable scene is a validator error. **Arc two has one phase left:
Phase 8 — The contract, and its first new author.**

## What it is

A page at `Projects/torchbearer.html` — 2,987 lines since Phase 7, nine ES module
imports, no build step, nothing the repo does not vendor. It is a Pathfinder 2e
Remaster **adventure engine**: it forges a 3rd-level hero through a nine-step
builder, drops that hero into a branching graph of scenes and skill checks, and
resolves the fights on a square grid with a real action economy — three
actions, multiple attack penalty, flanking, conditions, persistent damage,
dying and recovery, spell slots, focus points, a divine font. The board tags it
`CRPG` and gives it `class="has-suite"`; that class is a claim, and the claim is
that this is a platform.

It backs the claim with content that is *data*. `CORE_PACK` and
`ADVENTURE_PACK` sit inline in the page (6 ancestries, 10 backgrounds, all 8
Player Core classes, 73 feats, 42 spells, 28 items; 6 monsters, 2 companions,
the 25-scene Bell of Barrowmoor) and use the exact schema an external JSON pack
uses. `packs/` ships two more — The Long Vigil at Thornwake Bridge (12 scenes,
2 encounters) and Embers of the Hold, a worked example of every collection —
loadable from The Shelf in one click. `content-authoring-guide.md` is 361 lines
of contract in fourteen sections, and §13 is titled "Known simplifications
(don't 'fix' these in data)", the most useful heading in the project.

What it is not: a VTT. The guide states the intent as "correct-feeling PF2e at
level 3", and until Phase 6 meant *level 3* literally — `CHAR_LEVEL = 3`,
exported from `js/rules.js` since Phase 1, had eleven reads. It has one now:
the level a new hero is forged at. The level a sheet is computed from is
`build.level`, and a save clamps it to 1..10. It is also
not a VTT in the other direction either: `App` — the scenes, the Chronicle,
the saves, the Shelf — still lives in the `<script type="module">` inside the
HTML file, and the only automated browser that ever drives it is the
33-check `torchbearer` entry in `Tools/board-check/play-games.mjs`, which
since Phase 6 takes the committed hero from 3rd to 5th level through the
page's own buttons.

## The architecture that is there

- **`js/save.js` (156)** — the slot. `SAVE_KEY = "torchbearer-save"`,
  `SAVE_VERSION = 2`, a `migrate` that only deletes the dead `v:1` field, and a
  `repair` that is where the real work is: `repairBuild`, `repairHero`,
  `normalizePotions`, and a `repairSnapshot` capping the Chronicle at 80 entries
  of 4,000 characters because it is replayed with `innerHTML`.
- **`js/registry.js` (156)** — the content store and `Validator`. Its header
  states why it exists: "the validator IS the contract described in
  content-authoring-guide.md, and a contract nothing tests drifts."
- **`js/library.js` (46)** — fetches `packs/index.json` and one pack at a time,
  returns `[]` rather than throwing, and resolves URLs from `import.meta.url`.
- **`js/rules.js` (261)** — the PF2e math, out of the page in Phase 1.
  `PROF_VAL`, `SKILLS`, `CHAR_LEVEL`, `Dice` with an injectable source,
  `activeEffects`, `abilityMods`, `finalizeCharacter`, `skillMod`, and
  Assurance's floor. Imports `Registry` and nothing else.
- **`js/combat.js` (1,071)** — the combat engine, out of the page in Phase 2.
  Geometry, conditions, the AC and attack math, damage, saves, both strike
  paths, `start` and the turn loop, the player's actions from the button id
  down (`actionClick`, `cellClick`, `tokenClick`, `resolveTargeted`), the
  spells (`spellRows`, `armSpell`, `castAt`), and the monster AI (`aiStep`,
  `aiTurn`). No `document`, no `setTimeout`, no `App.`. It emits
  `{kind, text, cls}` events the page renders (locked #89), and its clock is
  `defer(fn, ms)`, which runs `fn` at once here and is `setTimeout` in the page
  (locked #92). Phase 3 added the reaction bus — `REACTIONS`, `trigger`,
  `reactionsOf`, `reachOf`, `reactiveStrike`, `mobilityCovers` — and a fifth
  seam, `askReaction`, which is yes here and a `confirm` in the page (locked
  #94 and #95). `start(encId, adv, {party, flags, onVictory, onDefeat})` takes
  the party and the flags as arguments (locked #93); `heroCombatant(ch)` and
  `companionCombatant(id)` are exported so a test builds the same party the
  page does.
- **`js/text.js` (10)** — `esc` and `cap`, imported by both sides (locked #91).
- **The three leaf modules, added by arc two.** Each imports *nothing*, because
  `registry.js` is the bottom of the dependency stack and its validator has to
  read all three, and because `test/smoke.mjs` drives every one of them under
  plain Node with no page, no Registry and no dice.
  - **`js/campaign.js`** (Phase 7, increment 1) — the flag grammar and its two
    scopes, the fold into the record, and the gates a campaign board reads.
  - **`js/shop.js`** (increment 2) — coin, price, the Treasure by Level table,
    and the arithmetic of buying and selling. Money is copper (locked #124).
  - **`js/downtime.js`** (increment 3) — `OPENERS`, the five states an encounter
    can begin in (locked #126); `EXPLORATION`, the three activities a
    `"kind": "explore"` scene offers; and `DOWNTIME` with the Player Core tables
    behind a rest, Treat Wounds, Earn Income and a Crafting bench. Nothing here
    rolls: `treatWounds` returns the formula and the bonus and lets the caller
    roll them, which is what makes "a critical success at Expert is 4d8 + 10" a
    thing a test can pin exactly rather than a distribution.
- **`test/smoke.mjs` (2,115, 706 checks)** — twenty-six groups: page wiring,
  shipped content validates, the manifest matches what is on disk, the
  validator rejects deliberately broken packs, the save slot, repair, the eight
  core classes at level 3, the effects DSL row by row, Assurance and dice, the
  combat core (geometry, off-guard, MAP, damage, Shield Block, strikes, saves),
  and the combat engine (the seams, the turn loop, `start`, the player's
  actions, spells, the monster AI, and a headless encounter). It reads
  `torchbearer.html` as *text* and slices the inline packs out with a
  brace-matching `sliceLiteral`, which is what testing an inline literal costs.
  `test/sera-voss.torchsave.json` (126) is a committed playthrough save,
  generated by actually playing the builder; `npm run games` imports it.

And then the page, in one file, at the line numbers Phase 3 left behind:
**24–438** the CSS (including a `.scene-art` rule nothing ever emits);
**533–1206** the two inline packs, inline on purpose so the page boots with
zero network requests; **1207–1230** what is left of the engine header, the
display names and `newBuild`; **1232–1731** `Builder` (502 lines), the
nine-step forge; **1732–1892** `Combat` (161 lines), the view and the reaction
prompt — `onEvent`, the seven hooks (`mount`, `defer`, `askReaction`,
`autosave`, `toast`, `hint`, `floatText`), `renderAll`, `renderTracker`,
`renderGrid`, `paintHighlights`, `renderBar` and the spell menu's cards;
**1896–2304** `App` (409).

The load-bearing habits are real and stated in the code. **Data, not code**: a
new class is a JSON object, and 35 `specials.includes("…")` checks naming 31
distinct hooks are the entire surface where content may mean something the
schema cannot say.
**Pure module plus suite**: `registry.js` and `save.js` each left the page
*because* they had caused bugs, and each arrived with its checks. **The
validator is the contract**, and `smoke.mjs` runs both shipped packs plus a set
of deliberately broken ones through it.

Where it breaks down is one sentence, and it is the reason this file exists.
Round 3 shipped `edge-outwit`, a Feint action, a reload mechanic and three new
`effAC` terms, and closed with: those `Combat`/`App` changes "live entirely in
browser-only code the Node suite doesn't import." The suite count did not move,
because it could not.

## Conventions a new builder must know

- **Never change the storage key.** It is `torchbearer-save` (locked decision
  #36), and `smoke.mjs` asserts it.
- **`migrate` is for version drift; `repair` is for every load** (#37), and
  `repair` covers *content* drift too (#50). The potion-heal fix went through
  `normalizePotions` in `repair`, not a version bump: a save carrying a bare
  number where a stack of item ids belongs is the same shape of problem as a
  save missing a field.
- **Save-format changes stay additive**, and every new field gets a default in
  `repairSnapshot`. `repairHero`'s comment names the bug the hook exists for:
  assigning `s.hero.resources` wholesale turned `potions` into `NaN`, the button
  stayed gated behind `>0`, and the potion silently never existed.
- **Verify a guard-rail by reintroducing the bug it guards** (#34). The
  validator group is built that way: each case is a pack with one thing wrong.
- **A `special` id is a promise; an unknown one is harmless.** Unknown ids
  render on the sheet and do nothing, so an inert hook is a missing feature and
  not a bug — but guide §8 is the list, and adding a hook to content without
  adding it to code and to that list is how a feat becomes a lie. Prefer the
  declarative effects: `note` plus `bonus`/`profUp`/`trainSkill` beats
  inventing a hook nothing reads.
- **Nothing in this page touches `localStorage` directly.** `smoke.mjs` strips
  comments and greps for `localStorage.` — one implementation of storage, in
  `gvb-save.js`, reached through `save.js`.
- **Do not hand-edit between the `gvb:social` markers** (#31). `npm run social`
  regenerates that block and your edit vanishes.
- **Zero offsite requests, no build step, no runtime npm dependency**, and each
  project vendors its own copy of anything shared (#17). `play-games.mjs`
  asserts the offsite count is zero every run.
- **The page must boot with no network at all** — hence the inline packs. The
  Shelf may fetch, because it can fail into a hidden section.
- **`Pathfinder/data/` is read-only and must not become a runtime dependency**
  until Devon says otherwise. Six sessions have wanted it; none has taken it.
- **The tests that actually work:** `node Projects/torchbearer/test/smoke.mjs`
  → 95 passed, 0 failed; `node assets/js/gvb-save.test.mjs` → 50 passed, 0
  failed; `cd Tools/board-check && npm run games` → the `torchbearer` entry is
  7 checks (5 of its own, plus the shared no-console-errors and no-offsite
  pair). `npm run games` opens a real visible browser window and Chrome
  throttles a window that loses focus — one at a time, never alongside
  `npm run play` or `npm run previews`.

## Questions for Devon

- **Is `Pathfinder/data/` a published interface other projects may read, or
  private to prompts 01–03?** Raised six times across three rounds, most
  recently by this project and The Absalom Inheritance jointly, tracked in
  prompt 01's own block. Unblocked work either way: if private, Torchbearer
  builds its own monster and treasure tables and stops asking; if shared, arc
  two gets cheaper and this project's boundary table changes.
- **Should Torchbearer be the site's PF2e rules engine, or only its own?** The
  Absalom Inheritance's round-3 notes name "a real interrupt point in the turn
  loop that doesn't exist yet" as its number-one next item — the same mechanism
  Phase 3 builds here. Solving it once, in the project that already advertises
  itself as a platform, is the recommendation. Whether the two ever *share
  code* is a separate question tied to the one above: #17 says each project
  vendors its own copy, so a shared rules module would be a deliberate
  exception.
- **Does the engine grow past level 3?** Guide §13 states the intent as
  "correct-feeling PF2e at level 3, not a rules-complete VTT", and Phase 6
  contradicts it on purpose. Worth doing only if a campaign is wanted.

## The standing backlog

Open and unclaimed. Add here rather than starting a new list.

**Levelling**
- **No spell step at level-up.** A caster's rank-2 slots grow from 2 to 3 at
  4th (`spellSlotsAt`), but the prepared list and the repertoire do not: a
  level-4 wizard casts the two rank-2 spells it knows three times between
  them, and a bard's repertoire never grows. `grantsAt` says nothing about
  spells, so the flow offers nothing. A `spells` step in level-up mode that
  adds one known spell when a rank's slot count rises is the shape; ranks 3
  and up are locked #114 and a bigger job.
- **The core pack's feats stop at 2nd level, so slots run dry.** A Fighter
  has five class feats in the pack, holds two at 3rd, and has nothing left
  for `class10`; a Rogue's every-level skill feat slot runs out of feats with
  met prerequisites sooner. The flow reads any feat at or below the slot's
  level, so a pack of level 4 to 10 feats is content work, not engine work.
  Until then a slot with nothing to offer is satisfied empty (locked #117),
  and the screen says so.
- **The adventure picker says "Level 3 adventure" and compares it to
  nothing.** A level-6 Sera walks into Barrowmoor at its level-3 DCs and
  foes; `minLevel` on individual foes is the only scaling, and none of the
  three shipped adventures uses it yet. The picker could warn when the hero
  is two or more levels off, or an adventure's checks could read `levelDC`
  relative to its `level`.
- **Companions never level.** They are flat stat blocks at whatever number
  they were written at, with no sheet for `minLevel` to read. By 6th the
  hero has outgrown Brother Aldous. Phase 7's campaign record is where a
  companion's level would live.
- **XP past 10th goes nowhere.** `canLevelUp` stops at `MAX_LEVEL`, and the
  counter keeps climbing with nothing to spend it on; the title screen says
  "the road ends at 10th". Anything past 10 is the later arc.
- **A level cannot be revisited.** An empty slot stays empty and nothing
  lets a hero retrain; the flow writes `advances[L]` once. Fine for a
  one-shot engine, wrong the day a feat pack arrives after the level did.
- **The fist wears the potency rune.** `weaponAttack` applies `kitAt`'s
  potency to whatever it is handed, the unarmed fallback included, as the
  flat `+1` did before Phase 6. Pinned as-is.

**Detection**
- **No monster can Hide, because no monster carries a Stealth number.** The
  schema has `perception` and nothing else, so `stealthDC` falls back to
  `10 + perception` for a foe and the Hide action is gated on `cb.char`. A
  `"stealth"` field on the monster schema plus an AI that Hides when it is
  losing would make ambush creatures play like ambush creatures; today they
  walk at you in the open like everything else.
- **The AI never Takes Cover and never Hides.** It Seeks, which is the only
  half of Phase 4 it uses, and only when it has lost every hero. A wisp that
  put a body between itself and the archer would be reading `coverBonus`
  backwards from what the archer reads it for, and nothing does that yet.
- **Cover has no corner rule.** It is read off the one Bresenham line between
  two squares, so a creature diagonally behind a pillar sometimes has +4 and
  sometimes nothing depending on which way the line rounds. Locked #101 says
  this is deliberate — a corner rule is a VTT feature — but it is the thing a
  player will notice first.

**The action economy**
- **No monster uses an Athletics maneuver, because no monster carries an
  Athletics number.** The four maneuvers are gated on `cb.char`, so a Trip is
  something that happens *to* monsters and never *by* one — and Rock Dwarf's
  "+2 DC vs Shove/Trip/prone" stays a note for exactly that reason. An
  `"athletics"` field on the monster schema plus an AI that Trips the heaviest
  armour in reach would make the ogre-shaped monsters play like ogres. It is
  the same missing-number shape as the Stealth entry above, and the two want
  one schema change between them.
- **`restrained` is not modelled, so a critical Grapple is only a harder
  Escape.** PF2e's crit clause is a condition that stops the target taking any
  action but Escape, which is a real AI change and a real action-bar change, so
  Phase 5 mapped the crit onto the higher Escape DC instead (locked #107). A
  player who knows the book will notice.
- **Disarm's −2 lands on every attack the target has.** The engine keeps one
  weapon per attack entry and no notion of which one a maneuver was aimed at,
  so a Skeletal Champion disarmed of its longsword also swings its gauntlet at
  −2. Naming the attack would mean an index on the condition and a per-attack
  read in `atkMod` and `strikeMonster`.
- **Ready arms one thing: a Strike, against a foe entering reach.** The bus has
  four triggers and Ready reads exactly one of them. "Ready a spell against the
  next creature that opens the door" is the tabletop version, and it needs a
  trigger picker in the UI more than it needs engine work.
- **Aid rolls Athletics whatever it is aiding** (locked #108), so a wizard
  helping another wizard's Arcana check rolls the strongest arm in the party.
  Passing the skill through the six call sites that consume an Aid is the fix,
  and it is worth doing the day a second thing wants the same plumbing.

**Reactions and the turn loop**
- **Only one monster in the whole game reacts, and it is in the sample pack.**
  The Forge-Tyrant in `packs/embers-of-the-hold.json` carries `"reach": 2` and
  `"reactions": ["reactive-strike"]`; Bell of Barrowmoor and Thornwake Vigil
  carry none, on purpose (locked #97), because handing the two real adventures
  a reaction is a balance change and Phase 3 was a mechanism. A player who
  never opens The Shelf still never meets one.
- **The AI does not know a threatened square exists.** `aiStep` walks the
  cheapest path to the nearest hero whatever it costs in reactions, never
  Steps, and never Strides the long way round. Now that a hero can carry
  Reactive Strike and a monster can walk out of its reach, that is a real
  tactical hole rather than a hypothetical one.
- No Ready, no Delay, and no reaction held for a specific trigger: the first
  trigger a combatant qualifies for takes its reaction for the turn (guide §13
  owns that one now).
- **Bellows Blast writes a condition the Chronicle prints as "The undefined
  afflicting Test ends."** The Forge-Tyrant's power carries
  `"onFail": [{"c":"persistent","v":1}]`, and a `persistent` condition needs a
  `dtype` and a `formula` — `addCond` stores it happily, `beginTurn` rolls
  `undefined` damage off it, and the expiry line names nothing. Found by the
  headless Embers fight this phase built to watch a reaction fire, and pinned
  as-is rather than fixed inside Phase 3: it is a content bug in one pack and
  the guide's §10 `powers` example does not show the persistent shape either,
  so both want fixing together.
- **A dead companion rises at the next fight.** `finish(true)` restores HP to
  every party member, dead or not (a companion who died at dying 4 leaves the
  field on 23 HP), and `start` sets `dead=false` and `dying=0` on the whole
  party. Found by the headless Causeway fight in Phase 2 and pinned as-is in
  `smoke.mjs`; the fix is in `finish`, and it wants a decision about what a
  dead companion means for the scene graph.

**Combat rules**
- **Monsters cannot flank.** Foe combatants are built in `Combat.start` with no
  `dying` field, so `isFlanking`'s `a.dying===0` partner test is
  `undefined===0` and never passes; and `strikeMonster` hands `effAC` a bare
  `{id, ranged}` with no `x` or `y`, so the geometry is `NaN` first. PF2e's
  flanking rule is symmetric. Pinned as-is by Phase 2 increment 1 with a test
  naming locked decision #90, because fixing it inside a refactor makes the
  next balance regression unattributable. The fix is `dying:0` in the foe
  literal plus passing the real combatant into `effAC`; it needs a balance pass
  behind it, because it makes every paired melee encounter in every pack
  meaningfully harder.
- Bursts, emanations and cones never call `losClear`: a Fireball rounds a
  corner and goes through a wall.
- `armSpell` gives `cone` and `line` the same `wedge`, and `castAt` resolves
  both with one quadrant test. A line is not a line.
- The AI never Steps away, and retreats only while `fleeing` — and a flee now
  provokes, like every other Stride.
- No Hide, Seek, Take Cover, Trip, Grapple, Shove (outside the `brutish-shove`
  feat), Escape, Aid, Recall Knowledge, Delay or Ready. Half a dozen shipped
  feats describe actions that do not exist — `edge-outwit`'s Stealth bonus is
  unbonused for exactly that reason, and the guide says so.
- Every creature still occupies one square, including the Large Forge-Tyrant.
  `reach` arrived in Phase 3 and it is a reaction's reach only: every melee
  attack still has `range: 1`, so a reach-2 monster threatens two squares and
  Strikes at one. No size. Flanking is
  exact-opposite squares only (guide §13 owns that one), and `passable()`
  treats an enemy as a wall and an ally as open floor.

**Character and content**
- `CHAR_LEVEL = 3`, eleven reads, no level 4. HP, proficiency, spell slots, the
  focus cap and the single skill increase all fall out of it.
- The `bonus` effect handles only `speed`, `hp` and `initiative`. Two shipped
  heritages use targets it never implemented — `sensate-gnome`'s +2 Perception
  to Seek, `gutsy-halfling`'s +1 to saves vs emotion — and unlike `save.all` in
  `profUp`, the guide does not warn about it.
- Seven hooks are flavour-only and honestly labelled: `bonus-dmg-vs-large`,
  `bonus-rest-heal`, `drain-bonded`, `ignore-difficult`, `reach-spell`,
  `trap-finder`, `widen-spell`. `battle-medicine` matches `build.feats` by name
  rather than through `specials`, so on a class feature it does nothing.
- No treasure, gold, shops, XP or downtime — victory grants a breather and that
  is the whole economy — and adventures do not chain: `snapshot()` carries one
  `advId` and one `sceneId`. `.scene-art` is styled and never emitted.

**Tooling and tests**
- 706 checks, none touching `Builder` or `App`. The headless encounter harness
  in `smoke.mjs` plays with a fixed die and a policy of Strike-or-Stride; a
  smarter policy (potions, Raise a Shield, the companion's heal before the hero
  is dying) would make its pinned outcomes say more about balance.
- Torchbearer still has no CI. None of the five workflows path-matches
  `Projects/torchbearer/**`; `node Projects/torchbearer/test/smoke.mjs` takes
  about a second and exits non-zero. Three PRs in a row have said this.
- The pack contract exists twice — as `Validator`, and as 361 lines of prose —
  with nothing keeping them in step but attention, and no authoring tool: a
  pack author writes JSON blind and finds out at load.
- `loadSave`'s "Content Missing" branch describes an import ordering
  `gvb-save.js` no longer has: `setState` runs first now, and `slot.save()`
  follows only if it does not return `false`. The manual re-save is redundant
  and the veto is unused.

## Arc one — the engine you can test

The engine's rules are good and nothing can prove it. Arc one builds for the
next person who has to change a combat rule: take the rules math and then the
combat engine out of the HTML file so the Node suite can drive them, then spend
that safety net on the two subsystems the file has been unable to grow —
reactions, and detection. **Ranked by impact, and the order is the
recommendation**: phases 3 through 5 each assume the module and suite phase 2
lands, and doing them first means shipping them unverified, which is the state
the project is already in.

Model convention here: most phases run on **Claude Opus 5**. **Claude Fable
5.1** is named only where a wrong answer would be silent — the combat
extraction, the interrupt point, the levelling schema — with the reason in one
clause each time. A phase is *finished* only when its branch has become a pull
request, that request has merged to main with CI green, and the closing report
names the **next open phase's number and its named model**, so nobody has to
reopen this file to know which session to start.

## Phase 1 — The rules core comes out of the page — SHIPPED

**Every function that computes a character was already pure, and none of them
could be called from a test.**

- [x] **`js/rules.js`.** 257 lines. `PROF_VAL`, `ABILITIES`, `SKILLS`,
  `CHAR_LEVEL`, `Dice`, `activeEffects`, `abilityMods`, `finalizeCharacter`
  (with `weaponAttack` and `dieUp` nested inside it, as they were) and
  `skillMod`, all verbatim. The page imports the ten names it uses and keeps
  `PROF_NAME`, `ABIL_NAME`, `DEG_NAME`, `DEG_CLASS` and `newBuild`, which are
  display, not math. Two checks in the page-wiring group fail if any of it is
  ever inlined again.
- [x] **A seeded die.** `setDiceSource(fn)` swaps the `[0,1)` source behind
  `Dice.d`, which is the only consumer of `Math.random()` in the game;
  `setDiceSource()` with no argument restores it (locked #87).
- [x] **Every core class in Node.** Eight sheets, one build shape — Human,
  Skilled Human, Soldier, Explorer's Clothing, no feats — with AC, HP,
  Perception, class DC, all three saves, Speed and spell slots asserted
  against the Player Core. Class DC did not exist before this: `keyAbil` was a
  dead local (locked #85).
- [x] **The effects DSL pinned,** every row of guide §6, against a fighter
  holding a made-up feat that carries nothing but that row. The three rows
  that do nothing are asserted as dropped (locked #88). Assurance is now
  `assuranceFloor`/`assuranceDegree` in the module, with its floor and its
  "never a crit" rule both under test (locked #86).

**What it found.** Nothing was wrong with the math. All eight classes agreed
with the book on the first run, and the Thornwake bridge scene renders Sera
Voss at AC 18 and 52 HP and Mercy Vane at AC 19 and 38/42 in a real Chromium
both before and after the cut. What was missing was class DC, which no code
path computed. Every guard-rail was broken on purpose (#34) and watched to
fail: uncapping Dex moved a Chain Shirt Rogue to AC 21, dropping `hpBonus`
lost Toughness, ungating `ifSubclass` gave a Cloistered cleric a Warpriest's
Fortitude, and ignoring the injected dice source turned a pinned natural 20
into an 8.

*Leaned on:* `js/registry.js`, `test/smoke.mjs`. *Save:* none. *Shipped under:*
**Claude Opus 5**.

## Phase 2 — Combat comes out of the page — SHIPPED

**Every rule in the fight is in a module, and the page draws it.**

`Combat` was 905 lines with the rules interleaved with thirteen render methods.
It came out in two cuts, split by dependency. Increment 1 (PR #129) took
everything a Strike passes through. Increment 2 took everything else that is a
rule — `start` and the turn loop, the player's actions from the button id down,
the spells, and the monster AI — and left 150 lines of view in the page.
`js/combat.js` is 911 lines; the page is 2,817 down to 2,293; `test/smoke.mjs`
is 335 checks up to 663.

- [x] **`js/combat.js`, DOM-free.** Increment 1: `key`, `dist`, `occupied`,
  `passable`, `losClear`, `reachable`, `cur`, `alive`, `spend`, `kill`,
  `condVal`, `addCond`, `decCond`, `buffSum`, `atkMod`, `effAC`, `isFlanking`,
  `saveMod`, `applyDamage`, `heal`, `meleeIdx`, `moveBudget`, `mapPenalty`,
  `strike`, `strikeMonster` and `rollSave`. Increment 2: `start`, `beginTurn`,
  `endTurn`, `nextTurn`, `checkEnd`, `finish`, `targets`, `actionClick`,
  `cellClick`, `tokenClick`, `doMove`, `provokeAlong`, `resolveTargeted`,
  `spellRows`, `armSpell`, `spendSpell`, `effectFor`, `castAt`, `aiStep` and
  `aiTurn`, plus `heroCombatant(ch)` and `companionCombatant(id)` as exported
  functions. 402 of the 518 non-blank lines that left the page's `Combat` are
  byte-identical in the module; the rest are the seams below. The page's
  `Combat` is still `newCombat()` with its view methods assigned over the top,
  and not one call site into it changed.
- [x] **An event log instead of `App.log`** (locked #89), and now `check`
  beside `seal`: Demoralize, Feint and Battle Medicine roll through
  `this.check(title, mod, dc)`, which emits the same `{kind:"roll"}` the page
  already renders, so `App.rollCheck` is only the scene checks' now.
- [x] **`defer(fn, ms)` is the clock** (locked #92). Every `setTimeout` in the
  engine — the recovery pause, the pause before a monster's turn, the beat
  between its actions, the victory beat — is `this.defer`. The module's runs
  `fn` at once, so `actionClick("end")` with two hounds on the board returns
  with both hounds' turns resolved and the hero up again, in one call. The
  page's is `setTimeout`, and the pacing is unchanged: a test asserts the
  engine asked for `600, 550, 550, 300` per hound.
- [x] **`aiStep` is one monster action** and returns `{action, wait}` — `flee`,
  `power`, `strike`, `shoot`, `move` or `pass` — or `null` when the turn is
  over. `aiTurn` is the five-line loop over it. Phase 3's interrupt point goes
  between two calls to `aiStep`.
- [x] **`start` takes its inputs** (locked #93): `start(encId, adv, {party,
  flags, onVictory, onDefeat})`. The flags object is mutated in place, because
  `surprise-round` and `fatigued-start` are consumed. The DOM it used to write
  is the page's `mount()` hook.
- [x] **The view adapter stayed in the page**: `renderAll`, `renderTracker`,
  `renderGrid`, `paintHighlights`, `renderBar`, `floatText`, `hint`, and
  `spellMenu`, which now renders the rows `spellRows` computes. Nothing in
  `js/` knows a colour. A guard in `smoke.mjs` slices the page's `Combat` out
  and asserts it rolls no dice, deals no damage, spends no actions, and has
  exactly two `setTimeout`s (`defer` and the floating number).
- [x] **A headless encounter harness.** `smoke.mjs` loads `ADVENTURE_PACK`,
  forges a fighter through `rules.js`, builds the party with `heroCombatant`
  and `companionCombatant`, starts `enc-moor` and `enc-crypt`, and plays them
  out with a fixed die (every d20 an 11) and a Strike-or-Stride policy. The
  outcomes are pinned — the Causeway is a six-round victory with Aldous dead,
  the crypt a seven-round defeat — so a balance change moves a line on purpose.
  Every Chronicle line is checked for `undefined` and `NaN`, and no two living
  combatants ever share a square.
- [x] **The scripted-ambush flag is pinned with `start`:** it docks every foe
  100 initiative, makes them off-guard through round 1, is consumed off the
  flags object, and clears when the order wraps.

**What it found.** Nothing wrong with a rule; the fights in a real headless
Chromium before and after the cut render the same numbers, and the AI resolves
melee and the marksman's bow through the page's `setTimeout` with no page
error. The harness found a quirk instead: **a dead companion rises at the next
fight.** `finish(true)` heals every party member including the dead — a
companion who died at dying 4 leaves the Causeway on 23 HP — and `start`
resets `dead` and `dying` on the whole party. Pinned as-is, in the standing
backlog. Thirty-six guard-rails were broken on purpose (#34) and each exited 1;
three of them stayed green on the first pass and the tests were tightened
(an ally standing *in* a line, a third foe in Electric Arc's range, a provoke
path that starts out of reach) until they fired.

*Leaned on:* Phase 1's `rules.js`. *Save:* none — combat state has never been
serialized and is not starting now. *Increment 1 shipped under:* **Claude Opus
5.** *Increment 2 shipped under:* **Claude Fable 5.1.**

## Phase 3 — Reactions, reach, and an interrupt point — SHIPPED

**Mobility protected you from a reaction nothing in this game could make.**

Three reactions existed. Two fired from inside the damage path because there
was nowhere else to put them; the third refused any mover that was not a foe,
and no monster carried the trait anyway, so the party had never once been
threatened by a reaction. Three rounds of notes correctly refused to fake it.
Building the interrupt properly landed four things at once: monsters threaten
squares, `mobility` is wired, Shield Block and Nimble Dodge have a real
trigger, and The Absalom Inheritance has a model to copy for the top item on
its list.

**Shipped.** `js/combat.js` 911 → 1,071 lines; `smoke.mjs` 663 → 706 checks.
Seventeen guard-rails were broken on purpose (#34) and each exited 1; two
stayed green on the first pass and the tests were tightened until they fired.

The Forge-Tyrant fight was also played headless five times either way, with a
hero policy that backs off two squares from round 3 on. Without Mobility the
retreating hero takes 5 or 6 Reactive Strikes per fight and lasts 8 to 9
rounds; with it, zero Reactive Strikes, 8 or 9 Mobility lines, and 11 to 12
rounds. That harness is also what found the Bellows Blast bug now in the
standing backlog.

- [x] **A trigger bus in `js/combat.js`.** It is `trigger(name, ctx)`, not
  `emit` — that name is the event seam (#89) and two `emit`s in one file is a
  trap (locked #94). `move-out-of-reach`, `manipulate`, `incoming-damage` and
  `incoming-attack`; every combatant with `reactionUsed === false` is offered
  the ones it qualifies for, in initiative order, and the reaction resolves by
  mutating `ctx` before the triggering action reads it back.
- [x] **`provokeAlong` lost its side check,** and reach is read per combatant
  (`reachOf`, cells, default 1). Step still provokes nothing; a monster's flee
  now does, because a flee is a Stride. `mobility` is decided by the Stride's
  own path cost against `floor(speed / 2)` and is out of guide §8's inert
  table.
- [x] **Monster data grew two fields:** `"reactions"` and `"reach"`, in guide
  §10, and the validator rejects an unknown reaction id (locked #96). The
  guide's `hold-breaker` example carries both; the monster that actually ships
  with them is the Large Forge-Tyrant in `packs/embers-of-the-hold.json`, and
  the two real adventures were left alone on purpose (locked #97).
- [x] **Shield Block and Nimble Dodge moved onto the bus,** and `askReaction`
  is a seam beside `defer`: yes in the module, a `confirm` in the page, called
  only when the combatant carries more than one reaction (locked #95). Guide
  §13's "shield block auto-triggers" line is gone.
- [x] **Suite checks on trigger order** — a foe killed by a Reactive Strike
  mid-flight never reaches the square it ran to and its turn is handed on
  rather than stalling the loop (locked #98); a hero with `mobility` walks two
  squares past a hound untouched and is struck on the third; a manipulate that
  follows a move in the same round finds the reaction already spent.

*Leans on:* Phase 2's module and event log. *Save:* none. *Model:*
**Claude Fable 5.1** — turn-loop interrupt ordering, where a wrong answer
produces a plausible battle log and no error. Worked under Claude Opus 5.

## Phase 4 — Detection: Hide, Seek, cover, invisibility — SHIPPED

**Half the Stealth feats in the file described an action the engine did not
have.**

`edge-outwit` granted +2 Stealth and the guide admitted it went nowhere.
`distracting-shadows` and `very-sneaky` described Hiding behind cover.
`sensate-gnome` granted +2 to Seek. All of it was note text, because detection
state did not exist: every combatant saw every other one, and `losClear` was
consulted only for ranged attacks and `maxTargets`.

**Shipped.** `js/combat.js` 1,071 → 1,309 lines; `smoke.mjs` 706 → 815 checks.
Thirty-one guard-rails were broken on purpose (#34) and each exited 1; three
stayed green on the first pass — the endpoint exemption in `coverBonus`, a Hide
roll being the DC to find it, and an undetected creature being untargetable —
and the tests were tightened until all three fired. The two shipped adventures
play line-for-line as they did: the pinned crypt fight is still the Warden
winning in seven rounds, because nothing in Bell of Barrowmoor or Thornwake
Vigil hides, conceals or stands in anybody's way.

- [x] **A detection map.** `detect[observerId][targetId]`, four states, with
  the `concealed` and `invisible` conditions as the base *under* the map rather
  than entries in it — clearing an override falls back to the condition, not to
  observed (locked #100). `isHidden(a,b)` and `flatCheckDC(a,b)` are DC 5
  concealed, DC 11 hidden. The expiry rule is `afterMove` and `afterAttack`:
  hiding survives neither, because there is no Sneak (locked #104).
- [x] **Cover from geometry.** `coverBonus` re-walks `losClear`'s Bresenham
  line: a wall is +4, a living body +2, a corpse nothing, and neither endpoint's
  own square is read. `effAC` takes the larger of that and Take Cover rather
  than the sum, because circumstance bonuses do not stack (locked #101). Take
  Cover is a one-action button that needs a wall in one of the eight squares
  around you and ends when you move or Strike. A monster's attack reaches the
  geometry through `opts.from`, so the wisp shoots at +2 AC and locked #90's
  no-monster-flanking stays pinned (locked #102).
- [x] **Hide and Seek as actions** — but not as `resolveTargeted` cases, which
  neither of them fits (locked #99). Hide is one Stealth roll compared against
  every foe's Perception DC separately, and it needs greater cover or
  concealment; `edge-outwit`'s +2 lands on the comparison against the hunted
  prey alone and is out of guide §8's it-goes-nowhere paragraph. Seek is a
  Perception roll over a 15-foot burst picked within 30 feet; a found creature
  becomes observed, a found *invisible* one only becomes hidden.
  `sensate-gnome`'s +2 arrives through a new `condBonuses` list on the sheet,
  the first conditional `bonus` anything reads (locked #103).
- [x] **The flat check in `strike`, `strikeMonster` and `castAt`.** One
  `flatCheck(att, def)`, called by all three; the Chronicle prints it through
  the same seal every other d20 uses, and a failure spends the action and
  raises the MAP. An area spell names a square and asks nothing. `concealed`
  and `invisible` are in guide §12 on the existing chip machinery.
- [x] **The AI respects it.** `aiStep` filters its target list on what the
  monster can detect and spends an action Seeking the three squares around
  itself when every hero has gone undetected — which is the only way a hero who
  hides gets found again without Seeking on their own side. Suite checks
  include Hide then Strike from hiding, a Seek that finds and one that misses
  by a square, a flat check that misses, and cover at +2 when the thing in the
  way is a person.

**What Phase 4 did not do**, and left where it found it: `very-sneaky` and
`trap-finder` stay inert notes (no Sneak action, no traps — locked #105); no
monster Hides, because none carries a Stealth number; and the general wiring of
`bonus` on `perception` and `save.all` is still Phase 5's row, not this one.

*Leans on:* Phase 2's module, `losClear`. *Save:* none. *Model:* **Claude Opus
5** — new rules, but they ride the module Phase 2 made testable and follow an
action pattern already in the file. Worked under Claude Opus 5.

## Phase 5 — The rest of the action economy

**Shipped.** Titan Wrestler let you Grapple creatures two sizes larger, in a
game with no Grapple and no sizes. There are both now.

- [x] **Athletics maneuvers.** Trip (→ `prone`), Shove (→ forced movement),
  Grapple (→ `grabbed`) and Disarm (→ `disarmed`), each one action, each an
  Athletics check against `10 + the target's own save modifier` for Reflex or
  Fortitude, and each carrying the attack trait so it takes the MAP and raises
  it. That DC is the plain PF2e formula and not Demoralize's
  `10 + save + level`; Feint and Hide were already plain, so Demoralize is the
  one out of step and moving it is a balance change to every fight (locked
  #106). `grabbed` is immobilized plus off-guard, and **Escape** rolls the
  better of Athletics and Acrobatics against the total that made the grab —
  the same shape Phase 4's `hideDC` uses, which is how a critical Grapple ends
  up harder to break without a second condition value (locked #107). A grip
  ends on its own when the grabber dies or walks off. **Stand** had to exist:
  before this phase nothing in the engine removed `prone`, so Trip would have
  been permanent, and the monster AI stands up before it swings.
- [x] **Aid,** the only action in the game that outlives the turn that spent
  it. One action on an adjacent ally, nothing rolled yet; the die comes out on
  the ally's next Strike, maneuver, Escape or skill action, and a critical
  success is +2, a success +1, a critical failure −1. The aider rolls Athletics
  against a flat DC 15 whatever it is aiding, because the engine cannot know
  which skill the ally's next check will use (locked #108).
  `cooperative-nature`'s +4 lands there, and an unused Aid is dropped at the
  start of the aider's next turn.
- [x] **Recall Knowledge, Delay and Ready.** Recall Knowledge is one check
  against the GM Core's level-based DC (`14 + level + floor(level / 3)`, 13 at
  level −1, in `rules.js` with the table pinned row by row), on a skill chosen
  off the creature's traits; a success prints AC and current HP, a critical
  adds the saves, the weaknesses and the monster's new optional `"lore"`
  string, and asking twice is +2 DC. Delay splices the combatant out of
  `Combat.order` and onto the end of it, ticks nothing, and is once per round.
  Ready costs two actions and arms one Strike against the same
  `move-out-of-reach` trigger read backwards — it fires on entering reach.
  A readied action is deliberately **not** a `REACTIONS` id, so content cannot
  name it and `KNOWN_REACTIONS` is untouched (locked #109).
- [x] **Creature size, and the two silent `bonus` targets.** `size` is on the
  sheet now (`rules.js` reads the ancestry's) and off the Registry entry for a
  monster; it gates which maneuvers reach a creature — one size up, or two with
  `titan-wrestler` — and fires `bonus-dmg-vs-large` for Mountain Strategy and
  Titan Slinger. The validator rejects a size it does not know, on monsters and
  on ancestries both, because a misspelling reads as Medium and quietly makes a
  Gargantuan creature wrestleable. `bonus` on `save.all` became real: `rollSave`
  takes the traits the save is against and reads any matching `condBonuses`
  entry, which is what finally makes Ancient-Blooded Dwarf's +1 vs magic and
  Gutsy Halfling's +1 vs emotion do something. `bonus` on `perception` still has
  exactly one reader — Seek — and the guide says so rather than pretending
  otherwise.

**Two notes became specials**, and had to: `titan-wrestler` and
`cooperative-nature` were `{"note": …}` entries in `CORE_PACK`, so no amount of
engine code could have seen them. Guide §8's working list is 45.

**What Phase 5 did not do.** PF2e's `restrained` is not modelled, so a critical
Grapple is an ordinary grab with a higher DC. Disarm's −2 lands on every attack
the target has rather than on the weapon it was aimed at, because the engine has
one weapon per attack entry and no way to say "that one". Only heroes make
maneuvers — no monster in the game carries an Athletics number — which is why
Rock Dwarf's "+2 DC vs Shove/Trip/prone" is still a note: nothing can Shove or
Trip a hero, so there is no DC for it to apply to. And Ready arms one Strike
against one trigger rather than an arbitrary action against an arbitrary one.

*Leans on:* Phases 2 and 3. *Save:* none. *Model:* **Claude Opus 5** — a table
of skill checks against DCs the engine already computes, each a variation on an
existing `resolveTargeted` case. Worked under Claude Opus 5.

## Arc two — the campaign

Arc one builds for whoever changes a rule. Arc two builds for the player who
finishes Bell of Barrowmoor at 4pm and wants to know what happens next, and for
the person writing the adventure that answers them: a level, a spine between
the fights, a machine-readable schema, and a new author to use it.
**Ranked by impact, and the order is the recommendation** — Phase 6 is a
prerequisite for Phase 7 and a headache after it, so it goes first or not at
all. Same terms as arc one, model convention and definition of finished
included.

## Phase 6 — A hero who levels — SHIPPED

**Shipped in two increments (PRs #139 and #141).** `const CHAR_LEVEL = 3` had eleven reads, and
every derived number hung off them. It has one read now, and that one is the
level a new hero is forged at; the level a sheet is computed from is the
hero's, and a hero with 1,000 XP banked takes the next one from the title
screen.

- [x] **Level becomes a build field.** `build.level`, defaulted to 3 and
  clamped to 1..10 by `repairBuild`, so every existing save reads back exactly
  as it did; `finalizeCharacter` reads it through `levelOf`, and every derived
  number hangs off it — HP per level, the proficiency bonus on AC, saves,
  attacks, Perception, class DC, spell DC and every trained skill, Assurance's
  floor, the resist that scales at half level, Toughness, and the rank
  cantrips and focus spells heighten to. `combat.js` reads `ch.level` for
  Demoralize's DC and Terrified Retreat; the page reads `levelOf(build)` for
  the skill preview and the Shield Block redundancy check. A class feature and
  its `special` now wait for their level, which no core content could tell
  before because every feature sits at 1 or 3. `MAX_LEVEL` is 10 (locked
  #111): the Player Core's tables past that are not the whole story, and the
  engine runs two spell ranks.
- [x] **The progression tables.** `FEAT_LEVELS`, `SKILL_INCREASE_LEVELS`,
  `BOOST_LEVELS` and `RANK_FLOOR` in `rules.js`, pinned row by row.
  `featLevelsFor` and `skillIncreaseLevels` read a class's own list first and
  the Player Core's row above its highest entry (locked #112), so seven of the
  eight core classes needed no data change and the Rogue spells its
  every-level rows out to 20 in a new optional `skillIncreases` field.
  `grantsAt(cls, level)` is the one answer the level-up screen will render:
  the feat slots, keyed the way `Builder.featSlots` keys the level-1-to-3 ones
  (`class4`, `skill4`, `ancestry5`, `general7`), whether the level carries a
  skill increase, and how many boosts. `spellSlotsAt` moves the class's
  level-3 row by the Player Core table for ranks 1 and 2 — 3/3 from level 4 —
  and ranks 3 and up do not exist yet (locked #114).
- [x] **Save version 3,** additive: `build.level`, `build.advances` — the
  per-level choice map, one `{feats, skillIncrease, boosts}` entry per level
  from 4 up — and `xp` on the snapshot. `migrate` stamps a version-2 save
  level 3 with an empty map and no XP whatever its fields say, because
  nothing before this phase could forge anything else, and `repair` shapes a
  version-3 one (locked #113). `smoke.mjs` has the v2→v3 round trip against
  the committed `sera-voss` fixture, which stays a version-2 file on purpose.
  `rules.js` already reads the map: feats chosen at 4 and up, the four boosts
  at 5 and 10 (partial past +4), and one skill increase per level at 5, 7
  and 9, with Master waiting for 7 and Legendary for 15 (locked #115).
- [x] **A level-up flow, not a rebuild.** `Builder` has a second mode
  (locked #117): `openLevelUp` clones the hero's build, sets its level one
  higher, and every step writes into `build.advances[level]` alone, so the
  preview sheet on the right is already the new level's. The rail shows only
  what `grantsAt` grants — Boosts, Skill Increase, Feats, Review, each
  present only when the level carries it — and the three step components
  are the builder's own with a `mode` branch: the boost chips write to the
  entry, the skill rows offer only what `skillIncreaseOptions` allows
  (Master waits for 7th and the row says so), and the feat cards come from
  `featChoices`, which excludes every feat the build holds at any level and
  checks a skill feat's prerequisite against the sheet's real ranks. A slot
  with nothing left to offer is satisfied empty and says why. `advanceMissing`
  in `rules.js` is what the footer button reads, so the whole gate is pinned
  under Node. "⬆ Take Level N" hands the build to `App.levelUp`, which spends
  the 1,000 XP, rebuilds the hero, carries potions and the wounded value
  over, refills HP and pools, and logs the change to the Chronicle. The title
  screen has the button and a status line ("1000 / 1000 XP toward level 4 —
  ready to level"). Adventures declare `"awards"` — whole XP per encounter id,
  paid on victory, and under `"ending"`, paid on the first ending scene — and
  an adventure that declares none is a milestone worth a level at its ending
  (locked #116). Each key pays once per playthrough, remembered as
  `awarded:<key>` in the flags map the save already carries. The kit's runes
  follow the level (locked #118): +1 potency from 2nd, striking from 4th, +2
  from 10th, and the gear hint says so.
- [x] **Encounter scaling and the guide.** `minLevel`/`maxLevel` beside
  `minParty`, read against the hero's level in `start` and typed by the
  validator, which now also refuses a non-integer `minParty` (locked #119).
  Guide §11 documents `awards` and the scaling fields with the level-based
  DC row, and §13 promises "correct-feeling PF2e from level 3 to 10".

**Increment 1's suite:** 947 → 1,027 checks. Twelve guard-rails were broken on
purpose (#34) — the migration, the clamp, the level gate on a feature's
`special`, partial boosts, the Master floor, slot growth, a class's own
`featLevels` list, the level filter on the choice map, Toughness, the map's
key filter, the cantrip rank and Demoralize's DC — and every one exited 1.

**Increment 2's suite:** 1,027 → 1,093 checks, and 21 guard-rails broken on
purpose — the milestone default, striking at the wrong level, potency never
reaching +2, a striking rune that doubled the dice, `featChoices` ignoring
taken feats and then prerequisites, `takenFeats` blind to the choice map,
the Master floor and a pick raising itself off the list, an empty slot
blocking the level, four boosts on three attributes, `canLevelUp` past 10,
the kit never reaching the sheet, `minLevel` and `maxLevel` unread, four
validator rules, the ending never paid, and a literal 1000 in the page — and
every one exited 1. `npm run games torchbearer` grew from 7 checks to 33: it
imports a version-3 save with 1,000 XP banked through the page's own Import
button, takes Sera Voss to 4th and then to 5th through every step the flow
has, and reads the level, the XP, `advances[4]` and `advances[5]` back out of
the slot.

*Leans on:* Phase 1's `rules.js`, `js/save.js`. *Save:* **version 3**, with
`migrate` doing real work for the first time; increment 2 added no field.
*Model:* **Claude Fable 5.1** — a schema change every downstream number and
every existing save inherits. Both increments worked under Claude Fable 5.1.

## Phase 7 — The campaign spine — SHIPPED

**Shipped in three increments (PRs #143, #145 and this one).** Between two
fights there is a scene, and between two adventures there was nothing.

`snapshot()` holds one `advId` and one `sceneId`, and finishing an adventure
calls `toTitle()`. No gold, no treasure, no shop, no rest but the half-HP
breather `finish(true)` grants, and nothing an author can write that spends
time rather than actions. This is the difference between an engine that runs a
one-shot and one that runs a table's year.

- [x] **A campaign record.** Shipped as increment 1. `campaigns` is a pack
  collection: `{"id","name","level","blurb","adventures":[{"adventure","if",
  "locked"}]}`, entries always objects (locked #120). The flag map got a second
  scope rather than a second map (locked #121): a bare name is the running
  adventure's flag, `barrowmoor/bell-answered` is the campaign record's, and
  `flagOk` in the new `js/campaign.js` reads whichever the name asks for — so a
  campaign entry's gate and a scene choice's `"if"` are one grammar and two
  adventures using `knows-name` cannot collide. An ending that is not a
  gameover folds its flags into the record under `<advId>/<flag>`, minus the
  `awarded:` bookkeeping, and adds itself to `completed`. The validator proves
  a gate can open: scoped, naming an adventure listed earlier, naming a flag
  that adventure's own scenes set. `SAVE_VERSION` stayed at 3 (locked #122) —
  the three new fields are additive and their pre-Phase-7 value is what
  `repair` computes anyway. One record per save (locked #123). Guide §11 grew
  a **Campaigns** subsection; `smoke.mjs` went 1,093 → 1,159 and drives the
  shipped campaign from an empty record to a finished one.
- [x] **Treasure by level.** Shipped as increment 2. Items carry a `level` and a
  `price`, and a price is a string written the way the Player Core prints it —
  `"12 gp"`, `"1 gp, 5 sp"` — parsed once into copper, because money counted in
  fractional gold drifts by a hundredth of a coin per transaction (locked #124).
  The purse and the pack are `gold` and `inventory` on the save, additive, and
  `SAVE_VERSION` stayed at 3 for the third time (#122's argument, again).
  Neither is cleared between adventures: money is the hero's the way XP is,
  which is what a campaign is for. `js/shop.js` holds the arithmetic —
  `parseCoins`, `coinText`, `buy`, `sell`, the Treasure by Level table — with no
  imports at all, so registry.js can read a price to reject a bad one.
  `"kind": "shop"` is a scene kind, from a closed list, that renders the
  adventure's declared `stock` to buy and the hero's own pack to sell at half.
  An adventure may hand out one hero's quarter share of PF2e's Treasure by
  Level for its own level and no more (locked #125); the validator sums every
  scene's `onEnter.gold` and granted items and rejects the rest. Two shops
  ship, one at each end of The Bell and the Bridge. `smoke.mjs` goes 1,159 →
  1,278 and the browser recipe 42 → 49.
- [x] **Downtime and exploration.** Shipped as increment 3. `js/downtime.js` is
  the third module with no imports of its own, beside `campaign.js` and
  `shop.js`, so `registry.js` can validate against its tables and `smoke.mjs`
  can pin every number under Node with no dice. Two halves.

  *Within a scene:* `"kind": "explore"` is the second scene kind, offering
  Search (Perception), Avoid Notice (Stealth) and Defend (no roll) against the
  scene's own DC. Picking one is picking not to do the other two, and a success
  leaves an **opener** for the next fight. The openers are a table now (locked
  #126): `surprise-round` and `fatigued-start` had been hardcoded by name in
  `Combat.start` since sessions 3 and 6 and were the only opening state content
  could ever write; `OPENERS` has five, and `scouted` is +2 to the party's
  initiative, `hero-hidden` opens the fight Hidden from every foe through Phase
  4's own detection, and `shield-braced` enters with the shield up if the hero
  carries one — surviving exactly one turn start, the way Raise Shield does.
  They stayed flags, so every `"onEnter": {"flag": "surprise-round"}` already
  written keeps working, and a near-miss like `suprise-round` is now a validator
  error rather than a scene that reads as an ambush and plays as an ordinary
  fight. Thornwake's `bridge-approach` ships the scene kind.

  *Between adventures:* Make Camp on the title screen, live only when no
  adventure is running. Long Rest (Constitution modifier × level HP, every slot,
  the font, focus, one step off Wounded — and Halfling Luck's day, which had
  never once turned over), Treat Wounds against the DC the Medicine rank buys,
  Earn Income on the Player Core's table by task level and degree, and Craft:
  half the price in materials, four days, and every extra day knocks a day's
  Earn Income off what is still owed. **Every activity costs exactly one day**
  (locked #127), which is what stops Treat Wounds being free unlimited healing
  and what makes a day at the bench a price against the coin it saves. `days`
  joined the save, additive, and **`SAVE_VERSION` stayed at 3 for the fourth
  time**.
- [x] **Checks at both ends.** Shipped as increment 3. `sceneGraph` in
  `registry.js` walks an adventure from its `start` and **an unreachable scene
  is a validator error** (locked #128) — the check that would have caught an
  unreachable shop without a browser, and it walks the edge the engine follows
  rather than the one the author wrote: a combat choice with no `defeat` is an
  edge to "gameover". All three shipped adventures pass it with 26, 14 and 7
  scenes reached and every ending reachable. `smoke.mjs` goes 1,278 → 1,439 and
  the browser recipe 49 → 64.

**Increment 3's suite:** 1,278 → 1,439 checks, and 48 guard-rails were broken
on purpose (#34) — the rest floor, four Treat Wounds rows, three Earn Income
rows, four craft-cost rules, the opener a failed check must not earn, the
opener table's own keys, six things `Combat.start` does with them, seven
validator rules, four `sceneEdges` cases, the walk itself, two `days` repairs,
seven page seams, two lines of shipped content and both guide drift checks —
and every one exited 1 from a green baseline. `npm run games torchbearer` went
49 → 64 and found two bugs no assertion under Node could: the downtime cards
were `data-camp`, which is the campaign picker's attribute in the same
`#modal-body`, and loading a save with `advId: null` left `App.adv` pointing at
the adventure that had been running — so the next autosave wrote its id back
into the file, and Make Camp stayed greyed for a hero demonstrably between two
adventures.

*Leans on:* Phase 6's level record, `App.gotoScene`, `resolveCheck`. *Save:*
additive, and all six have shipped — `campaignId`, `campaignFlags`,
`completed`, `gold`, `inventory`, `days`.
*Model:* **Claude Opus 5** — scene kinds and content tables on top of a save
record Phase 6 already designed.

## Phase 8 — The contract, and its first new author

**The pack contract exists twice and agrees by hand, and nobody has written
against it since it was documented.**

`Validator` enforces the contract; the guide describes it in 361 lines of
prose; the two have drifted before — five checks in `registry.js` are marked
"added session 8" because a scene with no `text` validated fine and then threw
`sc.text.map is not a function` when a player walked into it. One schema, read
by both ends, ends that. Then use it: the best proof this is a platform is
content written *only* through the contract by someone who changes no engine
code, and the best test of the tooling is being its first user.

- [ ] **`packs/schema.json`** — one JSON Schema for the envelope and every
  collection, written from `Validator` and guide §§1–11. `Validator` reads it
  for the required-field lists and keeps its friendly per-field messages, so a
  new field lands in one place; `smoke.mjs` gains a drift check.
- [ ] **`Projects/torchbearer/authoring.html`.** Paste or drop a pack, get the
  validator's errors inline with line numbers, a summary of what it contains,
  and a "load into the game" button. No build step, same leather and brass.
- [ ] **A dry-run preview.** Walk the scene graph without playing it: which
  scenes are unreachable, which `goto` targets nothing, which checks have no
  failure branch, which encounters no scene starts — graph traversal over data
  the validator already parses.
- [ ] **A second full adventure, written through the tool.** Level 3, 12–20
  scenes, three encounters, a branch that skill checks genuinely open, in the
  established voice: concrete, wry, a little gothic. Zero changes to
  `torchbearer.html`, or the phase has failed. With it, a bestiary pack: ten
  monsters across levels 1–6 carrying Phase 3's reach and reactions, which is
  also the shape the `Pathfinder/data/` answer takes if it comes back
  "private".
- [ ] **Guide §15, and an author's note.** How to use the tool, the standing
  rule that a new field lands in schema, validator and guide in one commit or
  in none, and one honest page on what was easy, what needed the guide open,
  and what the tool caught.

*Leans on:* `js/registry.js`, `content-authoring-guide.md`, `packs/`. *Save:*
none. *Model:* **Claude Opus 5** — a schema transcribed from an existing
validator, a page in an established style, and content that touches no engine
code.

## What this leaves for a later arc

- **A second buildable party member.** Companions are flat stat blocks; a party
  of three forged heroes is a different game and a different builder.
- **A GM mode** — run an encounter with no hero, move both sides by hand.
- **A sequel to something.** Two adventures and a campaign record carrying
  flags and gold between them, once Phase 7 has a record to carry.
- **Anything past level 10.** Even Phase 6 stops where the Player Core's own
  tables stop being the whole story.
- **Sound and art.** The `.scene-art` rule has been waiting since the CSS was
  written, and zero-offsite means every asset is vendored.
- **A shared rules module across projects.** Blocked on the second Devon
  question, and on #17, which currently says no.
