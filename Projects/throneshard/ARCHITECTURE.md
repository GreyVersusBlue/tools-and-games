# Throneshard (three.js MOBA) — Architecture & Module Contracts

Run: `export PATH=~/.local/node/bin:$PATH; npm run dev` (Vite, port 5173). Smoke test: `node scripts/smoke.mjs [url]`
(headless Chromium w/ SwiftShader; writes /tmp/shot.png, prints console errors + game state). `window.game` is exposed.
Use a different port for your own dev server if 5173 is taken (`npx vite --port 51xx`), and write screenshots to a
unique path so you don't clobber other agents.

## Ownership (each agent ONLY edits files in its own area; core/ is shared — see "Core changes")
| Area | Owner | Files |
|---|---|---|
| Core engine | lead | `src/core/*` (Game, Unit, Hero, Rules, Projectiles, EventBus, constants) |
| World / map / fog / pathing / lighting / post-fx | World agent | `src/world/**`, `public/assets/world/**` |
| Models + animation (heroes, creeps, buildings, neutrals) | Models agent | `src/models/**`, `public/assets/models/**` |
| Heroes, abilities, VFX | Heroes agent | `src/gameplay/heroes/**`, `src/gameplay/abilities/**`, `src/vfx/**` |
| Items + shop logic | Items agent | `src/gameplay/items/**` |
| AI (creep waves, towers, neutrals, Grimmaw, bot heroes), structure spawning | AI agent | `src/ai/**` |
| UI / HUD / menus / minimap | UI agent | `src/ui/**`, `public/assets/ui/**` |
| Input, camera, audio | Input agent | `src/input/**`, `src/audio/**`, `public/assets/audio/**` |

**Core changes:** if you truly need a change in `src/core/`, keep it minimal, additive and backward compatible
(new optional fields/methods, never rename). Prefer extending from your own module (subclass, event listener, monkey-patch
at init) over editing core.

Everything must degrade gracefully: other modules may still be stubs while you work. Always use optional chaining
when calling into another module (`game.vfx?.spawn?.(...)`). Never throw from update loops.

## Coordinates & scale
- Ground = XZ plane, +Y up, map spans [-100, 100]. Camera looks north = -Z.
- Sunward base bottom-left (-X,+Z); Duskward top-right (+X,-Z). River along x == z. Duskward layout = point-mirror (x,z)->(-x,-z).
- 1 world unit = 40 game units. Use `du(gameUnits)` from constants (e.g. `du(600)` = 15 world units cast range).
- Hero ~2.2 world units tall, creep ~1.6, tower ~9, throneshard ~12. Collision radius hero 0.7.
- All layout (lanes, towers, barracks, camps, shops, fountains, Grimmaw) lives in `src/core/constants.js`.

## Game object (`src/core/Game.js`)
`game.scene, camera, renderer, bus, time, frame, units[], heroes[], player {team, hero, selected[]}, heroDefs`,
`composer` (set it to an EffectComposer to take over rendering), `paused`, `timeScale`, `running`, `matchOver`,
`difficulty`.
Subsystems: `world, models, vfx, projectiles, abilities, items, rules, ai, ui, input, cameraCtl, audio`.
Each subsystem: `constructor(game)`, optional `async init(onProgress)`, `update(dt, rawDt)`, `onMatchStart()`.
Helpers: `spawnHero(id, team, {isBot, lane})`, `spawnUnit(opts)`, `removeUnit(u)`, `unitsInRadius(pos, r, filter)`,
`enemiesInRadius(team,pos,r,filter)`, `alliesInRadius(...)`, `canSee(team, unit)`, `delay(sec, fn)` (game time).
Flow: `main.js` → `game.init()` → `ui.onLoaded()` (menu / hero pick) → `game.startMatch({heroId, team, difficulty})`
which spawns 10 heroes (player + 9 bots) at fountains, then calls every subsystem's `onMatchStart()` and emits `match:start`.
The AI agent's `onMatchStart` spawns towers/barracks/throneshard/fountain/neutrals and attaches bot controllers.

## Unit (`src/core/Unit.js`) — base for everything with HP
Fields: `id, kind ('hero'|'creep'|'tower'|'building'|'neutral'|'summon'|'ward'|'grimmaw'), subtype, name, team, position
(Vector3), facing (yaw, 0 = +Z), alive, hp, mana, state ('idle'|'moving'|'attacking'|'casting'|'dead'), order,
attackTarget, modifiers[], model, object (Group in scene; model.root is its child), controller, lane, data {}, owner,
isStructure, immobile, invulnerable`.
Stats via `getStat(name)`: maxHp, maxMana, hpRegen, manaRegen, armor, magicResist, damageMin, damageMax, attackRange,
bat, attackSpeed, attackPoint, projectileSpeed, moveSpeed, turnRate, collisionRadius, vision, acquireRange,
bountyGold [min,max], bountyXp. Bonuses come from modifiers' `bonus` objects (and items for heroes). `<stat>Pct` keys
are multiplicative percents (e.g. `moveSpeedPct: 0.2`). Special bonus keys: `damage` (flat bonus attack dmg),
`str/agi/int/allStats`, `incomingDamagePct`.
Orders: `issueOrder({type:'move'|'attack'|'attackMove'|'cast'|'hold'|'stop'|'follow', point?, target?, ability?}, queue)`.
Cast order: Unit walks into `ability.getCastRange()`, faces target, waits `ability.def.castPoint`, then calls
`ability.cast(targetUnitOrPoint)` after re-checking `ability.canCast(target)` → `{ok, reason}`.
Damage: `takeDamage(amount, 'physical'|'magical'|'pure', source, {isAttack, crit, ability})`. `heal(amount)`,
`spendMana`, `restoreMana`. Modifiers: `addModifier({id, name, icon, debuff, duration, stun, silence, root, disarm,
morph, invulnerable, invisible, magicImmune, slow, bonus, stackable, maxStacks, onApply, onTick(u,dt), onExpire,
onAttackStart(u,target,info) (mutate info.amount / info.crit), onAttackLanded(u,target,info), onDamageTaken(u,info)
(mutate info.amount), vfx (Object3D, auto-removed)})`, `removeModifier(id)`, `hasModifier(id)`, `hasState(flag)`.
`controller` = `{ update(unit, dt) }` is called each frame before order processing (AI brains live here).
Ranged attacks call `game.projectiles.launch({source, target, speed, kind: unit.data.projectileKind ?? unit.modelKind,
isAttack: true, onHit})`.

## Hero (`src/core/Hero.js`) extends Unit
`def, heroId, level, xp, gold, abilityPoints, abilities[4] (Q,W,E,R), inventory[6], backpack[3], stash[], kills,
deaths, assists, lastHits, denies, respawnTimer, isBot, isPlayerControlled, lane`. `attr('str'|'agi'|'int')`,
`addXp, addGold(amount, reason), canLevelAbility(i), levelAbility(i)`. Attributes: str→22hp & 0.1 regen, agi→0.167 armor
& 1 AS, int→12 mana & 0.05 regen; primary attr → damage ('uni' = 0.7×sum). Items contribute via `item.def.bonus`.

## Model contract (`game.models.create(kind, {team, unit}) → model`)
`model = { root: Object3D, height: number, play(name, {once, speed, duration}), update(dt), dispose(), attachPoint?(name) }`
Animation names: `idle, run, attack, cast, death` (map to whatever clips exist; missing → graceful fallback).
Kinds: every `HeroDefs[x].model`, `creep_melee`, `creep_ranged`, `creep_siege` (use `{team}` for Sunward/Duskward looks),
`tower`, `barracks_melee`, `barracks_ranged`, `throneshard`, `fountain`, `shop`, neutrals `neutral_small`, `neutral_medium`,
`neutral_large`, `neutral_elder`, `grimmaw`, `ward`, `courier`, plus summon kinds the Heroes agent requests
(`summon_wolf`, `summon_treant`, `summon_golem`, `illusion` — illusion may clone a hero model tinted blue). Unknown
kind → sensible generic model, never throw. Root origin at feet, facing +Z. `model.height` used for bars/projectiles.

Combat hooks (every character + structure model):
- `model.flash(color = 0xffffff, duration = 0.12)` — hit flash on this instance only (materials are shared, so the
  model swaps in lazily-created private material clones for the flash; same shader program, no recompile).
- `play('attack', {duration})` scales the clip so the **whole swing lasts exactly `duration` s**; without `duration`
  it plays at `speed`. `model.attackHitFraction` (0..1) is where in that clip the weapon/spell visually connects,
  measured per clip (`CLIP_META` in `src/models/configs.js`) — it reflects the variant the *next* `play('attack')` will
  use, so read it right before playing. To land the swing on the damage point:
  `play('attack', { duration: attackPointSeconds / model.attackHitFraction })`. `play('cast', {duration})` behaves the
  same way (default ~0.9 s).
- `attachPoint(name)`: `head`, `chest`, `hand_r`/`weapon`/`attack`/`projectile`, `hand_l`, `overhead`, else root.
- `getPortrait(kind, {heroId, def})` → cached PNG data URL (head-and-shoulders render).

Characters are GLBs in `public/assets/models/chars/` (one skinned mesh, one baked albedo×AO texture, meshopt +
WebP; 23-bone shared rig) generated by `tools/blender/characters/build.sh` from CC0 Quaternius packs (see
`public/assets/models/CREDITS.txt`); `chars/anims.glb` holds all clips (Universal Animation Library 1+2).
`scripts/model_gallery.mjs <url>` renders every model/clip in the real renderer for review.

## Ability contract (`game.abilities`)
`setupHero(hero)` fills `hero.abilities` with 4 Ability instances from `def.abilities` ids.
Ability instance: `{ def: {id, name, icon, description, targetType: 'none'|'unit'|'point'|'passive'|'toggle',
targetTeam: 'enemy'|'ally'|'any', ultimate, maxLevel, castPoint, cooldown[], manaCost[], castRange[] (world units),
radius?, damageType?}, hero, level, cooldownRemaining, isItem:false, canCast(target) → {ok, reason},
getCastRange(), getCooldown(), getManaCost(), cast(target), update(dt), onLevelUp() }`.
Player/bots use it as: `hero.issueOrder({type:'cast', ability, target|point})` (or `ability.cast()` directly for
no-target after canCast). UI reads `def.icon` (emoji or image URL), `def.name`, `description`, cooldown/mana.
`game.abilities.getAbilityDef(id)` also used by UI tooltips.

## Items contract (`game.items`)
`ITEM_DEFS` exported from `src/gameplay/items/ItemDefs.js`: `{id, name, icon, cost, bonus{}, components?[], recipeCost?,
active? {targetType, cooldown, manaCost, castRange, castPoint}, description, category, shop:'base'|'secret'|'side'}`.
`game.items.buy(hero, itemId) → {ok, reason}`, `sell(hero, slot)`, `canUse(hero, slot)`, `use(hero, slot, target)`,
`swap(hero, a, b)`, `inShopRange(hero)`, `getShopCategories()`. Item instance: `{def, charges, cooldownRemaining,
isItem: true, canCast, cast, getCastRange, update}` — same shape as abilities so orders can `cast` them.

## VFX contract (`game.vfx`)
`spawn(name, {position, target, unit, radius, color, duration, direction}) → handle`,
`createProjectile(kind, {source, isAttack}) → {object, update?(dt), dispose?()}`, `projectileImpact(kind, pos)`,
`floatingText(text, position, {color, size})` (UI may also do this via events), `attachToUnit(unit, name, opts)`.
Generic names at minimum: `hit`, `blood`, `explosion`, `stun`, `heal`, `levelup`, `teleport`, `blink`, `death`,
`building_explode`, `move_marker`, `attack_marker`, `aoe_indicator`, `lightning`, `fire`, `frost`, `poison`, `shield`,
`spawn`, `gold`.
Readability helpers: `areaIndicator({position|follow, radius, source|team, delay, duration, flash})` draws a
terrain-draped spell-area rim (red = hostile to the player's team, green = friendly; `delay` adds a closing countdown
fill). Casters are inferred from the `ability:cast` fired in the same frame when `source` is omitted. `groundY` returns
the river surface where it is above the terrain. `shake(pos, intensity, dur)` (distance-scaled
`cameraCtl.shake`), `hitStop(dur, scale)` (short `game.timeScale` dip on crits/bashes involving the player's hero or an
on-screen hero; disabled whenever `game.fixedDt` is set), `hitFlash(unit, color, dur)` on every visible hit → calls
`unit.model.flash(color, dur)` if the model provides it, else an additive hit sprite. `Unit.attackAnimOpts()` scales the
attack clip so `duration * model.attackHitFraction` equals the real windup (`attackPoint / attackSpeed factor`).
Capture harness: `node scripts/vfx_capture.mjs <url> <outDir> <tag> [heroes|items|ids]` (every ability + item active,
two frames each, pair sheets + contact sheets; `ENEMY_VIEW=1` judges indicators from the enemy team). Note: a Vite
server started with `watch: null` caches modules — restart it after edits.

## AI contract
`AIDirector.onMatchStart()` spawns structures with `game.spawnUnit({kind:'tower', subtype: tier, team, lane, position,
modelKind:'tower', stats})`, barracks (`kind:'building', subtype:'barracks_melee'|...`), throneshard (`subtype:'throneshard'` —
its death ends the match via Rules), fountain (kind:'building', subtype:'fountain', invulnerable, strong attack),
creep waves every 30s, neutral camps, Grimmaw, and attaches `hero.controller = new BotBrain(...)` to `hero.isBot` heroes.
Tower protection: higher tiers are `invulnerable` until the previous tier in that lane dies.

## Runes, wards, talents, Ascendant Scepter, buyback (gameplay extras)
Registered through one subsystem, `game.extras` (`src/gameplay/GameplayExtras.js`), which exposes:
- `game.runes` (`src/gameplay/runes/Runes.js`): boon runes (haste, double damage, regeneration, invisibility, arcane,
  illusion) every 2 min from 2:00 at one of the two river spots; windfall runes at 0:00 and every 2 min at 4 jungle spots.
  Pickup = right-click (move order onto the rune) or walking over it; player heroes with a Flask store boon runes in it
  (`item.storedRune`, used via the Flask). `markers(team)` feeds the minimap overlay. Events `rune:spawned`,
  `rune:picked {hero, type, stored}`, `rune:activated`.
- `game.talents` (`src/gameplay/talents/`): talent trees at 10/15/20/25 (two options each, costs an ability point).
  Data in `TalentDefs.js`; effects are read by `Hero.bonusFromSources` (`hero.talentBonus`) and `Ability.v()/getCooldown/
  getManaCost/getCastRange/getRadius` (`hero.talentMods[abilityId][key]`, additive). Event `talent:chosen`.
- Ascendant Scepter: ultimates declare `scepter: { description, values?, cooldown?, castRange?, radius?, manaCost?,
  pierceImmunity? }`; `ab.hasScepter` (hero owns the item) switches `ab.v()` to the scepter values, ability code checks
  `ab.hasScepter` for behaviour changes. Tooltips read `def.scepterDescription`.
- Wards: `lookout_ward`/`seeker_ward` items (stock-limited) spawn `kind:'ward'` units (observer = vision source for fog,
  sentry = `data.trueSight` for `world.hasTrueSight`); `WardVisuals` draws allied vision rings; the item's `active.radius`
  drives the targeting circle.
- Buyback (`src/core/Rules.js`): `rules.buybackCost(h)` = 200 + net worth / 13, `rules.canBuyback(h)`, `rules.buyback(h)`
  (8 min cooldown), event `hero:buyback`. Bots buy back when the base is threatened (AIDirector).
- Bots: runes, warding (`src/ai/WardSpots.js`), Grimmaw attempts/contests, buyback, talents; difficulty profiles in
  `BotBrain.DIFFICULTY` (hard adds spell combos, lead aiming, burst-aware retreat, map awareness);
  `game.ai.setTeamDifficulty(team, level)` for asymmetric matches. Test: `scripts/match_stats.mjs`, `scripts/lh_test.mjs`,
  `scripts/ws5_shots.mjs`.

## UI contract
`setLoadingProgress(p, stage)`, `onLoaded()` (show main menu → hero select → `game.startMatch`), `update(dt)`.
DOM overlay in `#ui-root`. Health bars, damage/gold popups, HUD, minimap, shop, scoreboard, kill feed, end screen.
The UI reads `game.player.selected`, the hero, `game.items`, `game.abilities`; ability/item buttons call
`game.input.beginCast(ability)` / `beginItemCast(slot)` so targeting is shared with hotkeys.
Scaling: `UI.applyScale()` sets `--z` on the HUD (zoom = viewport height / 900, clamped 0.7–1.5 × user HUD scale) and
`--uz` on `#ui-root` for modals/tooltips; world-space bars/text scale by height too (WorldOverlay `vs`).
Tutorial tips: `hud/Tutorial.js` (contextual, one at a time, remembered in localStorage `throneshard.tutorial`).
Announcer banners: `notify.announce(title, sub, cls, dur, voiceLine)` emits `announcer {line}` when shown (voiced by audio).
Settings modal has General + "Controls & Hotkeys" tabs (cast mode, rebinding); extra canvases over the minimap should use
class `mm-markers` (transparent).

## Input contract
`Input`: RTS controls — right-click move/attack, A-click attack-move, S stop, H hold, QWER/DF cast (with targeting
cursor + range/AOE indicators), Z X C V B N items, Ctrl+Q..R level up ability, F1 select hero, space center, Tab
scoreboard (emit `ui:toggleScoreboard`), F4 shop (`ui:toggleShop`), left-click select unit (emit `selection:changed`),
`beginCast(ability)`, `beginItemCast(slot)`, `pickUnit(clientX, clientY)`, `pickGround(clientX, clientY) → Vector3`.
Hotkeys are rebindable: `input.keybinds` (`src/input/Keybinds.js`: `codeFor(action)`, `actionFor(code)`, `label(action)`,
`set(action, code)` (swaps on conflict), `reset()`, `onChange(fn)`; persisted in localStorage `throneshard.keybinds`);
`input.keyLabel(action)` for HUD hints. `input.castMode` = `'normal' | 'quick' | 'release'` (`setCastMode`, event
`input:castMode`); holding a hotkey shows its cast range. Holding right mouse re-issues move toward the cursor at ~10 Hz
(real time; not for shift-queued presses). Queued move markers are amber. `input:command {type, point, queue}`.
`CameraController`: MOBA camera (~60° pitch), edge-pan, arrow keys, middle-drag, wheel zoom, space to center/lock (F1 double
tap), `focus(x, z)` (used by minimap), clamps to map.
`AudioSystem`: `play(name, {position, volume, rate})` positional falloff relative to camera target, music, listens to bus.
Hero audio identity: `HERO_AUDIO` in AudioSystem.js maps heroId → {voice set, attack flavour, rate}; unknown heroes get a
deterministic fallback (or set `def.audio = {voice, attack, rate, castCat}` / `def.gender`). Voice clips live in
`public/assets/audio/voice/<set>/{cast,ult,grunt,death}_N.ogg` (built by `scripts/audio/build_voice_assets.py`, CC0).
Announcer: emit `announcer {line}` (first_blood, double_kill…massacre, killing_spree…mythic, shutdown,
tower_destroyed, tower_lost, grimmaw, grimmaw_ours); lines queue and never overlap. Buses: music, sfx, ambience, ui, voice.
Keybinds: `game.input.keybinds` (src/input/Keybinds.js: codeFor/actionFor/label/set/reset/onChange, persisted in
localStorage `throneshard.keybinds`); `game.input.castMode` 'normal'|'quick'|'release' (`setCastMode`, emits `input:castMode`).
UI tutorial tips: src/ui/hud/Tutorial.js (localStorage `throneshard.tutorial`).
Buses: music, sfx, ambience, ui, voice (`setBusVolume(bus, v)`, `setMusicVolume(v)`). Hero identity via `HERO_AUDIO`
(voice set + attack flavour per hero); unknown heroes get a deterministic fallback (gender from `def.gender` or name,
attack from attackType/projectileKind); `def.audio = {voice, attack, rate, castCat}` overrides. `voice(unit, 'cast'|'ult'|'death')`.
Announcer: `announce(line)` (queued, never overlapping): first_blood, double_kill…massacre, killing_spree…mythic,
shutdown (runtime formant voice `speak()`), tower_destroyed / tower_lost / grimmaw(_ours) / victory lines use Kenney CC0
samples. Voice clips are built by `scripts/audio/build_voice_assets.py` (Blender headless); credits in
`public/assets/audio/CREDITS.txt`.

## World rendering & performance (`src/world`, `src/models/structures.js`)
- Frame cadence (2026-09-30 pass, 60 FPS mid-fight on high and low at 1280x720 on a Vega 11): terrain tiles are culled
  per camera and packed into one dynamic index buffer (`world/TerrainTiles.js`, 2 draws); the sun shadow map renders every
  2nd frame (every frame on ultra) and bloom is recomputed on the frames between, re-blended in 1 draw otherwise; any
  quality change or resize forces a full pass. New outlined overlay text goes through `WorldOverlay.label()`, which caches
  it as a small canvas: per-frame `strokeText` was the largest GPU-process raster cost.
- Quality levels (`world.setQuality`): `low | medium | high | ultra` (Settings menu). High = tuned default for iGPUs
  (DPR <= 1.5, 2048 shadow map, 4 pooled torch lights, SMAA, grass 85%); ultra = DPR <= 2, 6 lights, full grass;
  medium/low = FXAA, 1024 shadows, fewer lights/grass; low also drops bloom and terrain anti-tiling.
- Terrain = 16x16 index-only tiles sharing one vertex buffer (frustum culled; only tiles with relief cast shadows).
- Foliage (`Foliage.updateView(camera)`, called from `World.update`): all trees/bushes/rocks/grass live in CPU arrays;
  only instances inside the camera's ground footprint (+ canopy/shadow/motion margins) are copied into per-bucket
  InstancedMeshes when the camera moved > 2.5 u or a tree was cut/regrew. Trees: LOD0 (< 52 u from camera, shadows),
  LOD1 reduced mesh (< 72 u, shadows), else billboard impostors baked at load from the gameplay view direction
  (albedo + view-normal atlases, no shadows). Grass thins with distance. `foliage.stats` has live counts.
- Fog of war: per-viewer visible-cell lists cached (LRU keyed by cell, radius, flying; cleared on tree changes); the
  display texture is re-blurred/blended incrementally (only changed cells) at <= 30 Hz.
- Post: render -> bloom (not on low) -> OutputPass with the colour grade folded in -> SMAA/FXAA. `post.grade.enabled`
  still toggles the grade. The main renderer has no MSAA backbuffer (AA is done in post).
- `World.forceSinglePassTransparents` (every 0.5 s) sets `forceSinglePass` on transparent, DoubleSide, non-depth-writing
  materials (rings, decals, VFX). Without it three.js draws each one twice and re-resolves its shader program every
  frame. New materials of that kind should set `forceSinglePass: true` themselves.
- Structures: baked GLBs in `public/assets/structures/` (built by `tools/blender/structures/build.sh`, meshopt+webp):
  `body` (albedo x AO + RGB region mask stone/metal/cloth tinted per team in the shader), `glow` (team emissive),
  `extra_sunward|extra_duskward` silhouette pieces. `initStructures()` (exported, auto-started on import) preloads them;
  builders fall back to the procedural primitives until loaded. Animated nodes (`crystal`, `pulse`, `orbit`, `spin`,
  `water`, `bob`) are still procedural children, so StructureModel animation/death behaviour is unchanged.
- Perf tools: `scripts/ws2_perf.mjs <url> [quality]` (profile.mjs + world sub-timings, main/shadow calls & tris),
  `ws2_diag.mjs` (tris/calls per scene group for main & shadow camera), `ws2_cpuprof.mjs` (V8 hot functions),
  `ws2_gpuexp.mjs` (toggle experiments), `ws2_shots.mjs <url> <outDir> [quality] [name:x:z:dist ...]` (fog-free shots),
  `ws2_matvariants.mjs` (finds materials whose shader program is re-resolved every frame).

## Events (game.bus)
`match:start {player}`, `match:end {winner, playerWon}`, `unit:spawned/removed {unit}`, `unit:damaged {unit, source,
amount, type, crit, isAttack, ability}`, `unit:healed`, `unit:died {unit, killer}`, `hero:killed {victim, killer,
killerHero, assists, firstBlood}`, `unit:attack {unit, target}`, `unit:attackLanded {unit, target, damage, crit}`,
`unit:order`, `hero:levelUp {hero, level}`, `hero:respawn`, `hero:gold {hero, amount, reason}`, `gold:popup {unit, hero,
amount}`, `ability:cast {hero, ability, target}`, `ability:learned`, `item:bought/sold/used {hero, item}`,
`projectile:launch/hit`, `building:destroyed {unit, killer}`, `wave:spawn`, `modifier:added/removed {unit, modifier}`,
`ui:error {unit, message}`, `ui:message {text, color}`, `ui:toggleShop`, `ui:toggleScoreboard`, `selection:changed {units}`,
`resize`, `grimmaw:killed`, `camera:focus`, `rune:spawned/picked/activated`, `ward:placed`, `talent:chosen`, `hero:buyback`.
