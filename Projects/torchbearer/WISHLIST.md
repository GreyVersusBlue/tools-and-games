# Torchbearer — Feature Wishlist

**Status: Phase 2 shipped.** The combat engine is `js/combat.js` (911 lines)
and `node Projects/torchbearer/test/smoke.mjs` is green at **663 passed, 0
failed** — up from 335, and 328 of those checks are new: the turn loop, `start`
against the real packs, every button on the action bar from its id down, the
spells shape by shape, the monster AI step by step, and two whole encounters
played headless with a fixed die. What is left of `Combat` in the page is 150
lines of view. The next open phase is **Phase 3 — Reactions, reach, and an
interrupt point**, on **Claude Fable 5.1**, a 1.

## What it is

A page at `Projects/torchbearer.html` — 2,293 lines since Phase 2, seven ES module
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
loadable from The Shelf in one click. `content-authoring-guide.md` is 324 lines
of contract in fourteen sections, and §13 is titled "Known simplifications
(don't 'fix' these in data)", the most useful heading in the project.

What it is not: a VTT. The guide states the intent as "correct-feeling PF2e at
level 3", and means *level 3* literally — `CHAR_LEVEL = 3`, exported from
`js/rules.js` since Phase 1 so Phase 6 has one place to change it. It is also
not a VTT in the other direction either: `App` — the scenes, the Chronicle,
the saves, the Shelf — still lives in the `<script type="module">` inside the
HTML file, and the only automated browser that ever drives it is the
seven-check `torchbearer` entry in `Tools/board-check/play-games.mjs`.

## The architecture that is there

- **`js/save.js` (156)** — the slot. `SAVE_KEY = "torchbearer-save"`,
  `SAVE_VERSION = 2`, a `migrate` that only deletes the dead `v:1` field, and a
  `repair` that is where the real work is: `repairBuild`, `repairHero`,
  `normalizePotions`, and a `repairSnapshot` capping the Chronicle at 80 entries
  of 4,000 characters because it is replayed with `innerHTML`.
- **`js/registry.js` (130)** — the content store and `Validator`. Its header
  states why it exists: "the validator IS the contract described in
  content-authoring-guide.md, and a contract nothing tests drifts."
- **`js/library.js` (46)** — fetches `packs/index.json` and one pack at a time,
  returns `[]` rather than throwing, and resolves URLs from `import.meta.url`.
- **`js/rules.js` (261)** — the PF2e math, out of the page in Phase 1.
  `PROF_VAL`, `SKILLS`, `CHAR_LEVEL`, `Dice` with an injectable source,
  `activeEffects`, `abilityMods`, `finalizeCharacter`, `skillMod`, and
  Assurance's floor. Imports `Registry` and nothing else.
- **`js/combat.js` (911)** — the combat engine, out of the page in Phase 2.
  Geometry, conditions, the AC and attack math, damage, saves, both strike
  paths, `start` and the turn loop, the player's actions from the button id
  down (`actionClick`, `cellClick`, `tokenClick`, `resolveTargeted`), the
  spells (`spellRows`, `armSpell`, `castAt`), and the monster AI (`aiStep`,
  `aiTurn`). No `document`, no `setTimeout`, no `App.`. It emits
  `{kind, text, cls}` events the page renders (locked #89), and its clock is
  `defer(fn, ms)`, which runs `fn` at once here and is `setTimeout` in the page
  (locked #92). `start(encId, adv, {party, flags, onVictory, onDefeat})` takes
  the party and the flags as arguments (locked #93); `heroCombatant(ch)` and
  `companionCombatant(id)` are exported so a test builds the same party the
  page does.
- **`js/text.js` (10)** — `esc` and `cap`, imported by both sides (locked #91).
- **`test/smoke.mjs` (1935, 663 checks)** — twenty-five groups: page wiring,
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

And then the page, in one file, at the line numbers Phase 2 left behind:
**24–438** the CSS (including a `.scene-art` rule nothing ever emits);
**533–1206** the two inline packs, inline on purpose so the page boots with
zero network requests; **1207–1229** what is left of the engine header, the
display names and `newBuild`; **1232–1731** `Builder` (502 lines), the
nine-step forge; **1732–1881** `Combat` (150 lines), now only the view —
`onEvent`, the six hooks (`mount`, `defer`, `autosave`, `toast`, `hint`,
`floatText`), `renderAll`, `renderTracker`, `renderGrid`, `paintHighlights`,
`renderBar` and the spell menu's cards; **1885–2293** `App` (409).

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

**Reactions and the turn loop**
- `provokeAlong()` opens with `if(mover.side!=="foe") return;` — a reaction can
  only fire against a moving *foe*, never against the hero or a companion.
- No monster in any pack carries `reactive-strike`, so even that half is
  unreachable, and `mobility` is not unwired but unwireable.
- The two reactions that do work, `shield-block` and `nimble-dodge`, fire from
  inside `applyDamage` and `strikeMonster` — at the moment damage is already
  being computed, because there is nowhere else to put them. Since Phase 2,
  `aiStep` is one monster action and returns what it did and the pause it
  wants, so there is finally a point *between* two AI actions where something
  else could act; nothing does yet.
- **A dead companion rises at the next fight.** `finish(true)` restores HP to
  every party member, dead or not (a companion who died at dying 4 leaves the
  field on 23 HP), and `start` sets `dead=false` and `dying=0` on the whole
  party. Found by the headless Causeway fight in Phase 2 and pinned as-is in
  `smoke.mjs`; the fix is in `finish`, and it wants a decision about what a
  dead companion means for the scene graph.
- The Chronicle never shows a monster's recovery: foes have no `dying`, so
  `applyDamage` kills them at 0 (correct), but the same missing field is why
  they cannot flank (#90).

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
- The AI never Steps away, and retreats only while `fleeing`.
- No Hide, Seek, Take Cover, Trip, Grapple, Shove (outside the `brutish-shove`
  feat), Escape, Aid, Recall Knowledge, Delay or Ready. Half a dozen shipped
  feats describe actions that do not exist — `edge-outwit`'s Stealth bonus is
  unbonused for exactly that reason, and the guide says so.
- Every creature occupies one square, including the Large `hold-breaker`, and
  every melee attack has `range: 1`. No reach, no size. Flanking is
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
- 663 checks, none touching `Builder` or `App`. The headless encounter harness
  in `smoke.mjs` plays with a fixed die and a policy of Strike-or-Stride; a
  smarter policy (potions, Raise a Shield, the companion's heal before the hero
  is dying) would make its pinned outcomes say more about balance.
- Torchbearer still has no CI. None of the five workflows path-matches
  `Projects/torchbearer/**`; `node Projects/torchbearer/test/smoke.mjs` takes
  about a second and exits non-zero. Three PRs in a row have said this.
- The pack contract exists twice — as `Validator`, and as 324 lines of prose —
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

## Phase 3 — Reactions, reach, and an interrupt point

**Mobility protects you from a reaction nothing in this game can make.**

Three reactions exist. Two fire from inside the damage path because there is
nowhere else to put them; the third refuses any mover that is not a foe, and no
monster carries the trait anyway, so the party has never once been threatened
by a reaction. Three rounds of notes correctly refused to fake it. Build the
interrupt properly and four things land at once: monsters threaten squares,
`mobility` becomes wireable, Shield Block and Nimble Dodge get a real trigger,
and The Absalom Inheritance has a model to copy for the top item on its list.

- [ ] **A trigger bus in `js/combat.js`.** `emit(trigger, ctx)` for
  `move-out-of-reach`, `manipulate`, `incoming-damage`, `incoming-attack`;
  every combatant with `reactionUsed === false` is offered the ones it
  qualifies for, and a reaction resolves *before* the triggering action
  completes.
- [ ] **`provokeAlong` loses its side check,** and reach is read per combatant
  (`reach` in cells, default 1) rather than assumed. Step still provokes
  nothing, and `mobility` — half-speed Stride, no reaction — is finally wired
  and moves out of guide §8's inert table.
- [ ] **Monster data grows two fields:** `"reactions": ["reactive-strike"]` and
  `"reach": 2`, in guide §10, with the validator rejecting an unknown reaction
  id the way it rejects an unknown monster. The Large `hold-breaker` carries
  both first.
- [ ] **Shield Block and Nimble Dodge move onto the bus,** and the player is
  asked rather than auto-triggered when the choice is real. Guide §13's "shield
  block auto-triggers" line changes with the code.
- [ ] **Suite checks on trigger order:** a foe that dies to a reactive strike
  mid-move stops moving; a hero with `mobility` walks past unharmed; a second
  trigger in the same round finds no reaction left.

*Leans on:* Phase 2's module and event log. *Save:* none. *Model:*
**Claude Fable 5.1** — turn-loop interrupt ordering, where a wrong answer
produces a plausible battle log and no error.

## Phase 4 — Detection: Hide, Seek, cover, invisibility

**Half the Stealth feats in the file describe an action the engine does not
have.**

`edge-outwit` grants +2 Stealth and the guide admits it goes nowhere.
`distracting-shadows` and `very-sneaky` describe Hiding behind cover.
`sensate-gnome` grants +2 to Seek; `trap-finder` finds traps without Searching.
All of it is note text, because detection state does not exist: every combatant
sees every other one, and `losClear` is consulted only for ranged attacks and
`maxTargets`. Detection is a per-pair state and a flat check — small once
combat is a module, and it unlocks content the engine already advertises.

- [ ] **A detection map.** `detect[observerId][targetId]` defaulting to
  observed; `isHidden(a,b)` and `flatCheckDC(a,b)` (DC 5 concealed, DC 11
  hidden), with expiry rules that survive a move.
- [ ] **Cover from geometry.** Reuse `losClear`'s Bresenham walk: a wall on the
  line is greater cover (+4 AC), a creature on it lesser cover (+2), both fed
  into `effAC`. Take Cover as a one-action button.
- [ ] **Hide and Seek as actions** — Stealth vs Perception DC (needs cover or
  concealment) and Perception vs Stealth DC over a burst of squares — as two
  more `resolveTargeted` cases in the pattern Feint set. `edge-outwit`'s +2
  finally has somewhere to go.
- [ ] **The flat check in `strike` and `castAt`.** A hidden target's attacker
  rolls it, the Chronicle prints it, and a failure costs the action.
  `concealed` and `invisible` join guide §12 on the existing chip machinery.
- [ ] **The AI respects it,** filtering `aiTurn`'s target list on what the
  monster can detect and Seeking when it loses one. Suite checks: Hide then
  Strike from hiding, a Seek that finds, a flat check that misses, cover at +2
  when the thing in the way is a person.

*Leans on:* Phase 2's module, `losClear`. *Save:* none. *Model:* **Claude Opus
5** — new rules, but they ride the module Phase 2 made testable and follow an
action pattern already in the file.

## Phase 5 — The rest of the action economy

**Titan Wrestler lets you Grapple creatures two sizes larger, in a game with no
Grapple and no sizes.**

Athletics maneuvers, Aid, Escape, Recall Knowledge, Delay and Ready are the
verbs a PF2e player reaches for and finds missing. Each is a skill check
against a DC the engine can already compute, and most produce a condition it
already implements. This phase makes the shipped feat text true.

- [ ] **Athletics maneuvers.** Trip (→ prone), Shove (→ forced movement),
  Grapple and Disarm, each against the target's Fortitude or Reflex DC and each
  respecting MAP. `grabbed` is a new condition that blocks movement and costs an
  action to Escape.
- [ ] **Aid.** Prepare on one turn, roll on an ally's next check: the only one
  here that persists across a turn boundary, and the first real use for
  `cooperative-nature`'s +4.
- [ ] **Recall Knowledge,** one check against a level-derived DC that prints a
  line of stat block into the Chronicle (monsters gain an optional `"lore"`
  string), plus **Delay** — a move within `Combat.order` — and **Ready**, one
  action armed against a trigger from Phase 3's bus.
- [ ] **Creature size, and the two silent `bonus` targets.** `size` is in the
  monster schema and read by nothing — use it for maneuver DCs and for
  `bonus-dmg-vs-large`, inert since it shipped. `bonus` on `perception` and
  `save.all` becomes either a real conditional bonus the check sites consult or
  a documented note; either way the guide and the code agree.

*Leans on:* Phases 2 and 3. *Save:* none. *Model:* **Claude Opus 5** — a table
of skill checks against DCs the engine already computes, each a variation on an
existing `resolveTargeted` case.

## Arc two — the campaign

Arc one builds for whoever changes a rule. Arc two builds for the player who
finishes Bell of Barrowmoor at 4pm and wants to know what happens next, and for
the person writing the adventure that answers them: a level, a spine between
the fights, a machine-readable schema, and a new author to use it.
**Ranked by impact, and the order is the recommendation** — Phase 6 is a
prerequisite for Phase 7 and a headache after it, so it goes first or not at
all. Same terms as arc one, model convention and definition of finished
included.

## Phase 6 — A hero who levels

**`const CHAR_LEVEL = 3`.**

Eleven reads, and every derived number hangs off them: HP per level,
proficiency bonus, the resist that scales at half level, Toughness, the focus
cap, the single skill increase, the spell ranks the builder offers. Making
level a property of the character rather than of the file is the change
everything downstream inherits — worth doing once, with Phase 1's suite
watching.

- [ ] **Level becomes a build field.** `build.level`, defaulted to 3 by
  `repairBuild` so every existing save stays exactly as valid as it is today;
  `finalizeCharacter` reads it from the build and `CHAR_LEVEL` survives only as
  the default for a new hero.
- [ ] **The progression tables.** Feats by level and class, skill increases at
  the levels that grant them, boosts at 5/10/15/20, proficiency advances from
  each class's own `features` array — which already carries `level` on every
  entry and already filters on it.
- [ ] **A level-up flow, not a rebuild:** a screen offering only the choices the
  new level grants, reusing `Builder`'s own step components and writing back
  into the same `build`. Adventures declare `"awards"`; `finish(true)` credits
  them, milestone by default, since every shipped adventure is a one-shot.
- [ ] **Save version 3,** additive: `level`, `xp`, and the per-level choice map.
  `migrate` fills a v2 save with level 3 and the choices its build implies;
  `smoke.mjs` grows a v2→v3 round trip, pinned against the committed
  `sera-voss` fixture.
- [ ] **Encounter scaling and the guide.** Add `minLevel`/`maxLevel` beside the
  existing `minParty`, and rewrite guide §13's "correct-feeling PF2e at level
  3" — if this ships, the promise changes.

*Leans on:* Phase 1's `rules.js`, `js/save.js`. *Save:* **a version bump to 3**,
with `migrate` doing real work for the first time. *Model:* **Claude Fable
5.1** — a schema change every downstream number and every existing save
inherits.

## Phase 7 — The campaign spine

**Between two fights there is a scene, and between two adventures there is
nothing.**

`snapshot()` holds one `advId` and one `sceneId`, and finishing an adventure
calls `toTitle()`. No gold, no treasure, no shop, no rest but the half-HP
breather `finish(true)` grants, and nothing an author can write that spends
time rather than actions. This is the difference between an engine that runs a
one-shot and one that runs a table's year.

- [ ] **A campaign record.** `campaigns` as a new pack collection: an ordered
  list of adventure ids, a starting level, per-adventure gates on flags earlier
  ones set. `App.flags` is already a flat saved map; scope it so a campaign can
  read what a previous adventure wrote. Validator and guide §11 grow with it.
- [ ] **Treasure by level.** An item `level` and `price`, a per-adventure budget
  following Paizo's table, gold that persists in the save, and a
  `"kind": "shop"` scene to spend it in — buy from a list the adventure
  declares, sell at half.
- [ ] **Downtime and exploration.** Between adventures: a long rest, Treat
  Wounds, a Craft or Earn Income roll against the level table. Within a scene:
  Search / Avoid Notice / Defend, each modifying the next encounter's opening
  state the way `surprise-round` does — that mechanism exists, it just has one
  hardcoded flag.
- [ ] **Checks at both ends:** a two-adventure campaign driven end to end in
  `smoke.mjs`, and the `npm run games` recipe extended one beat past the fight
  it currently stops at.

*Leans on:* Phase 6's level record, `App.gotoScene`, `resolveCheck`. *Save:*
additive — `campaignId`, `gold`, `inventory`, completed-adventure list.
*Model:* **Claude Opus 5** — scene kinds and content tables on top of a save
record Phase 6 already designed.

## Phase 8 — The contract, and its first new author

**The pack contract exists twice and agrees by hand, and nobody has written
against it since it was documented.**

`Validator` enforces the contract; the guide describes it in 324 lines of
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
