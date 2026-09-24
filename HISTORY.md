# HISTORY

What shipped on greyversusblue.com, and the numbered decisions code cites.
**Nothing open lives here**: open work is ranked in `BACKLOG.md`, plans are in
the per-project `WISHLIST.md` files, and work that will not be done is in
`ARCHIVE.md`.

**This file was cut from 11,791 lines to its current size on 2026-09-23.**
Every decision kept its number and its rule; the reasoning around each was cut
to a sentence or two, and the per-project logs to a paragraph per phase. The
long version is in git history: `git show ce70ad9:HISTORY.md`. Read that when a
decision's short form is not enough to reverse it safely.

**How to add to it.** A new decision is one entry at the end of "Locked
decisions", in the same shape: bold rule, one to three sentences of why, the
project in italics. A shipped batch adds one paragraph to its project's log.
Numbering continues from #588.

---

# Notes

**`sync-social-tags.mjs` lives in this repo, and `GreyVersusBlue/AI_Tools` went
looking for it there (2026-09-05).** AI_Tools' social blocks and READMEs cite
`Tools/board-check/sync-social-tags.mjs`, `npm run social`, `npm run
social:check` and `npm run games`. All four are real, here, not there: its docs
were written against this repo's board-check package. Nothing was lost and
nothing here changed. Whether AI_Tools gets a copy waits on its branding
decision, because its blocks have drifted into two brandings and 41 of its
tools have none.

**2026-09-23: Firebase Hosting dropped.** `firebase.json` and its deploy
workflow were deleted. The ignore list that kept `Numina/source-material/` off
the live site went with them, and Numina's `sw.js` no-cache header was replaced
by a check that `offline.js` never registers with `updateViaCache: 'all'`.

---

# Locked decisions

Code cites these by number, and for this repo's numbers this is the only place
they resolve. From #491 this file and Castle Conundrum's number independently
(#492), so a number means the file it is written in.

Two have moved since they were written: **#26** was amended in v6
(`interaction.js` tests line of sight itself now, not only `npm run play`), and
**#35** was formalised into code as **#55**. **#395 was never assigned**; the
gap predates this rewrite.

**#1. The parchment paints from `.notice::before`, not `.notice`.** The old `clip-path` on the anchor clipped every descendant (half-dome pins, no ribbons, no unfurl). `::before` paints at `z-index:-1` inside `isolation:isolate`, `.unfurl` at `z-index:-2`. Pins now float as full heads above the card edge, on purpose. *Site handoff v1 §3.*

**#2. "Sports Bar Sim" is the archive card, not a dead link.** It points at `Projects/The-Fourth-Quarter.html` (the original 2D build), carries `class="archived"` and reads "OLD NOTICE — STILL PINNED". `.archived` (desaturated paper, ink eyebrow, greyed seal) is a reusable retirement state. *Site handoff v1 §3.*

**#3. Bestiary Gallery lives under Pathfinder, not Town Services.** Town Services means schoolhouse tools. *Site handoff v1 §3.*

**#4. Ren-Faire's `package.json`, `package-lock.json`, `.gitignore` and `tests/` stay.** The reason is in that project's README. *Site handoff v1 §3.*

**#5. Seal glyphs are per project; ribbon tags are per genre.** Two different axes on purpose. Do not collapse them. *Site handoff v1 §3.*

**#6. The ledger rail is generated from the DOM, never hand-authored.** A card with `data-tags="Sim"` updates chip counts automatically. Never hard-code counts. *Site handoff v1 §3.*

**#7. Interactive spans inside `<a>` cards use `preventDefault()` plus `stopPropagation()`.** Applies to `.tag-ribbon`, `.suite` and `#p-seal`, following the Anathema Archive easter egg pattern. It is technically invalid HTML (interactive content inside an anchor), knowingly. *Site handoff v1 §3.*

**#8. `404.html` links are root-absolute.** Relative links break it on subpaths. *Site handoff v1 §3.*

**#9. Bump the version line by one every session.** `<p class="board-note version">version 2</p>` replaced "Postings Last Updated on 7-24-26"; an HTML comment above it says so. *Site handoff v1 §3.*

**#10. `#quest-board .notice { padding-top: 2.15rem }` is load-bearing.** It is the reserved band the corner ornaments live in. Removing it brings back the overlaps, which `check-collisions.mjs` catches. *Site handoff v2 §8.*

**#11. Collision measurement is 2D.** Horizontal proximity is not overlap. *Site handoff v2 §8.*

**#12. `Tools/board-check/` stays out of the served experience and gitignores its own dependencies.** It is dev tooling, same rationale as Ren-Faire's test scaffolding (#4). *Site handoff v2 §8.*

**#13. A check that only prints is a check that gets ignored.** Both checkers exit non-zero. Keep that. *Site handoff v2 §8.*

**#14. `Tools/` is capitalized, including `board-check` inside it.** Windows hides case; git and GitHub Pages do not. Match the case in scripts, docs and CI. *Site handoff v3 §6.*

**#15. `npc.js` honours `modelPath` on an NPC def generically.** No NPC id is hardcoded to a model; assigning a real model is a `data/npcs.json` edit. Do not special-case NPC ids in `build()`. *Site handoff v3 §6.*

**#16. `getDialogueLines()` returns the raw array with the `{RIDDLE}` token intact.** Substitution is `quest-manager.js`'s job. Moving it into `npc.js` would double-substitute or desync from `hasRiddleToken`, which greps the same literal. *Site handoff v3 §6.*

**#17. Each project vendors its own `libs/`; nothing is shared across projects.** Aphelion and The Fourth Quarter both run three@0.160.0 from separate copies of `libs/three.module.js`, so bumping one project cannot silently affect another. Exceptions for site files: #43, #51. *Site handoff v4 §5.*

**#18. Castle Conundrum's `libs/addons/` mirrors three.js's `examples/jsm/` layout.** Use `loaders/`, `controls/`, `utils/` rather than flattening (as Golden Hour does for `Sky.js`/`Water.js`) for any addon with internal relative imports, since flattening means hand-patching vendored import paths that rot. *Site handoff v4 §5.*

**#19. `Tools/board-check` vendors three.js from npm for its offline-rendering shim, unrelated to site vendoring.** Do not conflate the two. Its `three-0.160.0/` and `three-0.169.0/` are npm-authoritative copies handy for re-copying a project's vendored file. *Site handoff v4 §5.*

**#20. `launch()` in `harness.mjs` picks its engine by `process.platform`, not by probing.** Linux tries `@sparticuz/chromium` first; everything else goes to Playwright's channel list. A probe would add a slow failing attempt in exactly the CDN-unreachable sandboxes `@sparticuz/chromium` was chosen for. *Site handoff v4 §5.*

**#21. NPC to model casting is `King`→Guard, `Adventurer`→Scholar, `Farmer`→Wizard.** The filenames are actively misleading. To revisit, render the three models first; reasoning from names gives a worse answer. *Site handoff v5 §6.*

**#22. `hideMaterials` and `hideNodes` on an NPC def are the sanctioned way to subtract from a cast model.** Generic, data-driven, no NPC id consulted. Use them instead of editing a vendored `.gltf` or special-casing in code. *Site handoff v5 §6.*

**#23. Rigged models load through `loadGLTF()` and clone via `SkeletonUtils`.** Never `Object3D.clone()` a `SkinnedMesh`: the copy keeps the original's skeleton and silently refuses to animate while the mixer and clip appear to run. *Site handoff v5 §6.*

**#24. Held props are aimed from rig geometry, tip following the fingers.** The mean of the hand bone's child offsets points out through the fingers, and the prop's heavy end goes that way. The natural-looking opposite puts the prop inside the arm. *Site handoff v5 §6.*

**#25. Verify anything visual in headed Chrome via `playwright-core`, not the in-app browser pane.** The hidden pane does not composite WebGL, so rAF never fires and frame-dependent checks hang instead of failing. *Site handoff v5 §6.*

**#26. NPC positions are checked against geometry, not just the interact prompt.** Interaction was proximity plus facing with no line of sight, so the prompt showed for a Guard sealed in a wall. `npm run play` enforced it; amended in v6 so `interaction.js` tests line of sight itself. *Site handoff v5 §6.*

**#27. `play-castle.mjs` runs headed on purpose; `launch({ headed: true })` is opt-in.** Every other script stays headless. Pointer lock and GPU rendering need real compositing, and headless fails as a hang, not an error. *Site handoff v5 §6.*

**#28. A preview is a frame from play, and the capture script must prove it got there.** Every recipe asserts intro overlays are gone and makes a positive DOM claim about gameplay; recipes with a clock also assert the frame changes. Screenshot-only scripts left five sessions with no previews. *Site handoff v6 §9.*

**#29. `live: false` on a turn-based recipe is correct, not a workaround.** Closing Time and Faire Weekend have still frames while played. Do not animate something to satisfy a motion check. *Site handoff v6 §9.*

**#30. One chosen frame produces both the 330×200 hover preview and the 1200×630 share card.** Same moment, two crops, so they never disagree. Resize and encode happen in a canvas; do not add an image library. *Site handoff v6 §9.*

**#31. Page titles and descriptions live in `index.html`'s notices; every head is generated from them.** Reword the notice and run `npm run social`. Never hand-edit inside the `gvb:social` markers: it gets overwritten and `npm run social:check` flags drift. *Site handoff v6 §9.*

**#32. The favicon is one shared inline SVG data-URI on every page.** Per-project marks were rejected: the icon is the site's identity and costs zero requests this way. *Site handoff v6 §9.*

**#33. Castle Conundrum occlusion tests go against the mesh tree, not `castle.colliders`.** Decorative geometry can be `noCollide` (the gate arch is), so the collider list does not describe what you can see through. *Site handoff v6 §9.*

**#34. Verify a guard-rail by reintroducing the bug it guards.** Two line-of-sight checks passed the full suite while doing nothing; only moving the Guard back into the wall caught them. Break the thing on purpose and watch the check fail. *Site handoff v6 §9.*

**#35. Direct `camera.rotation` writes only work where `PointerLockControls` does.** Three of four 3D projects rewrite rotation every frame. Use `lookAt` for those, preferred over `turnBy` because Playwright clicks under pointer lock accumulate yaw and pitch drift. Formalised as #55. *Site handoff v6 §9.*

**#36. A project adopting `gvb-save.js` keeps its existing storage key.** Changing it silently abandons everyone mid-campaign. Unversioned saves read as version 0 and come through `repair`. Bent once, for a read-time migration, by #59. *Site handoff v7 §10.*

**#37. `migrate` is for version drift; `repair` is for every load.** Any fill-in that must happen whatever the version says (including a project's pre-existing `load()` pass) goes in `repair`. Extended to content drift by #50. *Site handoff v7 §10.*

**#38. The way into a game lives in `games.mjs`, once.** Any script that must get past a title screen imports `enter()`. Two copies of an opening is what `drive.mjs` and this file exist to prevent. *Site handoff v7 §10.*

**#39. Assert against the DOM for anything that just happened, and against the save only for what a reload must survive.** Three of six games write localStorage on a timer or a path a report never reaches, and a stale save reads like a broken game. *Site handoff v7 §10.*

**#40. A guard-rail that can be satisfied by luck gets seeded, not retried.** Integer Foundry's random sink target is written into the save before the dependent run, with the outgoing page's autosave disarmed first. *Site handoff v7 §10.*

**#41. Headed runs launch with backgrounding disabled.** A suite whose result depends on whether the runner clicked away is not a suite. *Site handoff v7 §10.*

**#42. Measure before deciding an asset is too heavy.** The only argument against vendoring the sand texture for two sessions was an unchecked size estimate 4× too big. Two `curl -I`s settled it. *Site handoff v7 §10.*

**#43. The site's own fonts live in `assets/fonts/`, shared by `index.html` and `404.html`.** #17 is a parallel-safety rule for projects; these two pages are the site, owned by one thread, so sharing is safe. See `assets/fonts/README.md`. Extended by #51. *Site handoff v8 §9.*

**#44. `page.__blocked` means offsite and refused; `page.__shimmed` means offsite and fulfilled locally.** A page can show an empty `__blocked` and still hotlink Google Fonts, because `harness.mjs`'s font shim answers first. `check-integrity.mjs`'s static source sweep is the check that scales past what a browser suite drives. *Site handoff v8 §9.*

**#45. Faire Weekend: a day is final once the gates close.** `runDay()` applies results on click, so persisting the report and locking it against replay are one action. Reloading mid-report now keeps the day instead of rewinding. *Site handoff v8 §9.*

**#46. A tool's version lives in the page, not the filename.** `TOOL_VERSION` shows in the header and is stamped into published files; board `href`s use permanent names (`Tools/schedule-browser.html`, `Tools/schedule-visualizer.html`). Old dated paths stay as redirect stubs so bookmarks do not 404. *Site handoff v8 §9.*

**#47. `gvb-save.js`'s `fresh`/`reset` forward arguments to the `defaults` factory, and `clear()` erases without calling one.** Adopters' day-one state depends on a runtime choice (which brokerage), and building a fresh state only to clear the key was waste. *Site handoff v8 §9.*

**#48. `mountSaveBar` takes `filename` and `labels` overrides, and its import calls `setState` before writing storage, vetoable by returning `false`.** Three adopters needed their own vocabulary; one needed to stop a rejected import overwriting a good save. *Site handoff v8 §9.*

**#49. `gvb-save.js` guards both storage-construction gaps the memory fallback exists for.** `typeof localStorage` itself can throw when storage is blocked (it is a declared accessor), and `load()`'s `getItem` was unguarded. Either would have taken a page down in private or storage-blocked browsers. *Site handoff v8 §9.*

**#50. `repair` also covers content drift, not just schema drift.** A data-driven save with one entry per content file will meet saves written before some content existed. That is not a version problem, and `repair` runs on every accepted load for exactly this. *Site handoff v8 §9.*

**#51. `assets/fonts/` extends to any file that is the site itself.** `newindex.html`, linked from a board notice and committed by Devon, is board-adjacent, so its fonts joined the shared folder instead of starting a third precedent. Extends #43. *Site handoff v9 §10.*

**#52. `Tools/board-check/package-lock.json` is tracked; `node_modules/` stays ignored.** An unpinned lockfile is how #3's bug (v9 §3) went unnoticed for a whole round. *Site handoff v9 §10.*

**#53. A real-time movement or physics assertion failing under Linux software-rendered Chromium is inconclusive, not confirmed.** `harness.mjs`'s Linux args force software rendering, which runs three.js scenes measurably slower and less consistently than their physics assume. Re-verify on real Chrome/Edge before trusting a fail or a pass. *Site handoff v9 §10.*

**#54. `play-games.mjs`'s Golden Hour wading beat re-aims with arrow keys before its `KeyW` hold, not `lookAt()`.** Earlier look-tests leave the camera facing anywhere, and `lookAt()` silently no-ops once pointer lock is released. The fix polls `camState().facing` toward 0 with arrow keys. *Site handoff v10 §10.*

**#55. `drive.mjs`'s `walkTo()` takes `{steer:'lookAt', sens}` for games that hand-roll their camera.** Aphelion, Golden Hour and The Fourth Quarter overwrite `aimAt()`'s raw `camera.rotation.set()` within about 16ms. Formalises #35 into working code. *Site handoff v10 §10.*

**#56. Before blaming a `lookAt()`/`turnBy()` steering fix, check whether pointer lock is held at that point.** These games gate mousemove on `document.pointerLockElement` or `this.locked`, so any earlier `exitPointerLock()` in the test silently disables the next `lookAt()`. *Site handoff v10 §10.*

**#57. `sync-social-tags.mjs`'s generated block matches the target file's line endings, not a hardcoded `\n`.** Windows `core.autocrlf=true` rewrites LF blocks to CRLF, so a hardcoded-LF comparison shows permanent false drift. *Site handoff v10 §10.*

**#58. `check-integrity.mjs`'s offsite-host sweep covers `.js`, `.mjs` and `.css`, not just `.html`.** `/libs/` joined its `SKIP` list for vendored bundles, and `SKIP` matching is now case and separator normalized after it silently matched nothing on Windows. *Site handoff v10 §10.*

**#59. #36 bends for a read-time migration, and only for one.** Bell to Bell renamed six keys (`chart`/`known`/`rapportBase` and `*5` twins to `p4.chart`, `p5.known`...) via `migrateLegacyKeys`, run once before any read. Asserted: old in and namespaced out; stored JSON `null` is a value; namespaced wins when both exist; idempotent. Do the migration or leave keys alone. *Bell to Bell Phase 1.*

**#60. A generated roster is a function of its seed and nothing else.** Bell to Bell's 7th period draws twelve kids from one six-digit integer, no `Math.random`. The tell schedule is seed plus day plus attempt; a balance miss re-rolls the schedule, never the roster. An unfittable roster throws with the last miss in its message. *Bell to Bell Phase 2.*

**#61. The semester record stores twelve values, never a Mastery scalar, and the night pulls them toward baseline from both sides.** Entries carry `comp[]` by seat and `base[]`; gains keep `retainOvernight` of themselves and losses recover by the same share. A one-sided floor sent a 7th period from 29 to 12 in a week. *Bell to Bell Phase 3.*

**#62. An exported page's link back points at the page that made it, or `greyversusblue.com` when there is none.** Hearth's saga export uses `location.href` minus hash on `http:`/`https:`, so previews and forks link to their own build. From `file://` the canonical URL is the fallback. Always hard-coding production would hide a tester's change. *Hearth Phase 4.*

**#63. A guard-rail that can pass with its guarded code deleted needs a precondition, not a longer run.** Deleting Hearth's living-only song-carrier filter left `saga` mode green at 170 days on seed 7. The mode now refuses to pass unless the run produced every assertion's material (outlived carrier, grown story, stone, named place, thing, four years) and names what is missing. *Hearth Phase 4.*

**#64. A link to an unsimulated place carries a seed, not a save, and the two seeds are each other's.** The far island link is `#s=<seed in base 36>`, with `farSeed(s) = (s ^ 0x5f1a1e) >>> 0`, an involution. It is derived in `newWorld()` with zero `R()` draws so every old share link keeps its exact terrain. *Hearth Phase 5.*

**#65. A luxury bought off the trader comes out of a surplus, not the housing stock.** Timber is houses and houses are `popCap()`. A floor of 14 built 24 houses instead of 28 and spent 203 of 700 days at the cap with births off (seed 20260819). The floor is 34 (30 surplus plus the 10 spent): 31 houses, zero days at the cap. *Hearth Phase 5.*

**#66. A check on a decision reads the state the decision was made from, not the state left afterwards.** Hearth's `fourteen` mode read `graves.length` after the walk, so an elder dying mid-walk demanded an impossible ending. Both checks now read from launch in `boundsOut()` and search the dead as well as the living. *Hearth Phase 5.*

**#67. A gate on a rare random event is sized against the chances the run gave it.** Hearth's `decade` elder-telling is a 5% daily roll on eligible days, which swing 26 to 171 per run. The mode counts eligible days and fails only when zero tellings had odds `0.95^n < 0.05`, printing count and odds. Sharpens #63; the other three systems keep the flat rule. *Hearth Phase 5.*

**#68. A store is counted against the cold season, not the winter.** At the old 13 measures a head the store stood at 1.32 to 1.75 times it every year on seeds 7, 20260819 and 42, so famine could never fire. Consumption implies 2.8 a head a day over seven cold days: 19 a head (`COLD` in `js/core.js`), short about one winter in four. *Hearth Phase 6.*

**#69. Rationing answers scarcity and may not read as starvation.** The short winter adds slow hunger (`+.0008` a step versus the empty store's `+.005`), capped at `.45` while the store is not empty; uncapped it reached `.78` and emptied the island. Rations: everyone works at `.85`, the last eater at `.9` of that, the store lasts `1/.62` as long. *Hearth Phase 6.*

**#70. Every hardship state is ended by the calendar, not a roll, and the ending is written down.** `endWant()` runs on the first day of spring whatever the store says, and `newDay` clears stood-down elders whenever there is no famine, so `strain` can assert the island is off rations every day of a forty-day run. A rivalry gets a third ending: left unsettled because one party left the island. *Hearth Phase 6.*

**#71. When a check's material is a matter of chance and the island can produce it, force it; keep the thinness guard for when it cannot.** `saga` needs a song that outlived a carrier, and seed 7 reached day 401 with every carrier alive. The mode now takes one carrier of a song that has others (as `wider` forces its cargoes), keeping #63's guard for when none exists. *Hearth Phase 6.*

**#72. Illness is a wave with a clock on each person, not a flag an arc owns.** `p.sick` had one setter and clearer inside the fever arc, and `newDay` healed everyone when it ended. Now: one door in (`takeSick`), one out (`wellAgain`), `sickD`/`wellD` on the person, and an `ill` record shaped like `want`. The arc opens a wave but heals nobody. *Hearth Phase 6, increment 2.*

**#73. The contagion off-ramp is a bound a check can hold every day.** Nobody is in bed past `SICKD` (6) days and a wave stops spreading after `WAVED` (12), so no wave is older than 18 days. `WELLD` (14) immunity stops a second lap. `strain` asserts all of it daily, and puts twelve people at the cap at once because the first version passed with the cap deleted. *Hearth Phase 6, increment 2.*

**#74. A system that draws from the random stream only when its subject exists costs nothing to islands without one.** The spread rule's `R()` calls sit behind `if(ill)`, so islands with nobody sick run the exact prior stream and `soak`, `determinism`, `save`, `decade`, `saga`, `wider` stayed on their islands. Write new rolls inside the condition that makes them matter. *Hearth Phase 6, increment 2.*

**#75. Nearness is the whole spreading mechanism; no building is named in the rule.** Spread is a distance (1.9 tiles) and a rate (`.004` a step); the fire, market and bell already gather people. A hall gives the sick a better recovery roll when more than one is in bed. Nursing makes friends, and uniquely turns a rival back into a friend. *Hearth Phase 6, increment 2.*

**#76. A feud is the rival pair the raid makes, and the raid is its only door in.** `feud` is a record like `want` and `ill`: one door in (`startFeud`, only from `wantRaid`), one out (`endFeud`, exactly one chronicle entry). Feuding pairs work at `.8`, avoid each other (`shunned`, 4 tiles; `apart`). `strain` holds `squared + walked + parted + worn + open` equal to raids that started one. *Hearth Phase 6, increment 3.*

**#77. Nursing mends a feud, and only the feud's own door writes the entry.** Nursing, the `mend` dream, the thaw and a fire night end it `squared`; walking the bounds ends it `walked`. `nursedBy` and `wakeDreams` hand the pair to `endFeud` and write nothing themselves. Death or a boat ends it `parted` the next morning via `feudDay`. *Hearth Phase 6, increment 3.*

**#78. A feud wears out at forty days, and the children inherit it on purpose.** `FEUDD` is 40; `feudDay` ends older feuds as `worn` (still rivals), and `strain` asserts the bound daily. Children of either side avoid the other side, and one who comes of age inside a feud takes it up (`feudInherit`) as a rivalry the feud's end does not undo. *Hearth Phase 6, increment 3.*

**#79. The children's ring has one phase, and it is the clock.** Each child used its own angle off `p.off`, so it never read as a ring. `ringPhase()` is `time*.3`, each child adds the slot its name sorts into (`ringOf(anchor)`), and `render.js` draws held hands off unsaved `p.ring`/`p.rA`. No new `R()` draws; `leftovers` asserts the angle exactly. *Hearth Phase 7.*

**#80. An elder can tell a child of anyone they outlived, and the ones they knew come first.** Any grave dug after the elder came ashore qualifies (death day lives on the grave), with known dead picked first. The child must have been unborn or under five that day. The real throttle is the island producing an elder at all, so the roll stays `.05`; `tellOfDead` is its own function for the harness. *Hearth Phase 7.*

**#81. What is asked at the stone is a weighted draw, with "not today" in the draw.** `faithDay` asked in fixed order, so a fever hid a drought. Each want now has a weight (sick `.6` plus `.4` a head, dryness past `.35`, etc.) and a standing `.3` for nothing keeps dreams near one day in ten. *Hearth Phase 7.*

**#82. A birth may overshoot the population cap by one, on purpose.** The cap counts beds a boat must find; a baby is born into its parents' house. The one is `BIRTH_OVER` in `core.js` with the reason beside it, answering Q17. Changing it moves every island's stream. *Hearth Phase 7.*

**#83. Hearth's CI is two jobs, and the deep one never runs on a pull request.** `hearth-ci.yml` gates PRs on `determinism`, `save`, a twelve-day `soak` and `pinned`; a nightly `deep` job runs all fifteen modes as a matrix, `fail-fast: false`. The browser is pinned to Playwright 1.56.1 / Chromium 1194 because V8's Math moves between releases; bumping it means `pinned --write` in the same PR. *Hearth Phase 8.*

**#84. Hearth does not join the board's regression suite; its preview waits for the social-tag cleanup.** `npm run games` runs headed on a desk and would duplicate the `save` mode #83 already runs. A 330x200 preview touches `index.html`, `assets/og/` and a missing social block, so it goes with that cleanup. *Hearth Phase 8.*

**#85. Class DC is on the sheet, computed the standard way.** `finalizeCharacter` assigned `keyAbil` and never read it, so no class DC existed. `classDC = 10 + proficiency bonus + key ability modifier` and `keyAbil` are now on the finalized sheet (17 at level 3, 18 for Rogue), not yet rendered. *Torchbearer Phase 1.*

**#86. Assurance is one function, not arithmetic in two places.** Two bugs came from inline math in `Story.choose` and `Story.resolveCheck`. `assuranceFloor(ch, skill)` (10 + proficiency, flat 10 untrained, no ability mod) and `assuranceDegree(floor, dc)` (only 2 or 1, never a crit) live in `js/rules.js`. *Torchbearer Phase 1.*

**#87. Randomness in Torchbearer enters through one door a test can hold.** `Dice.d` is the only `Math.random()` consumer; `setDiceSource(fn)` in `js/rules.js` pins every roll without patching a global, and `setDiceSource()` restores it. *Torchbearer Phase 1.*

**#88. The three effects rows that do nothing are pinned as doing nothing.** `bonus` on `perception`, `bonus` on `save.all` and `profUp` on `save.all` parse and are dropped. `test/smoke.mjs` asserts each as currently dropped against a control build, so wiring one up is a visible test diff; each was broken on purpose and failed (#34). *Torchbearer Phase 1.*

**#89. The combat engine emits events; the page renders them.** `js/combat.js` never calls `App.log` or `App.rollSeal`. `this.log(text)` and `this.seal(title, d20, math, deg)` push `{kind:"log"}`/`{kind:"roll"}` onto `this.events` and `onEvent`; tests read the array. `floatText` is a module no-op the page overrides. *Torchbearer Phase 2, increment 1.*

**#90. Monsters do not flank the party, and this is pinned rather than fixed.** Foes have no `dying` field (`undefined===0` fails in `isFlanking`) and `strikeMonster` passes `effAC` a bare `{id, ranged}` with no coordinates. A refactor that also buffed every monster would make balance regressions unattributable, so a test pins it; the fix waits in the backlog with a balance pass. See #102. *Torchbearer Phase 2, increment 1.*

**#91. `esc` and `cap` live in `js/text.js`, imported by engine and page.** Both build HTML from pack-supplied names, and two escapers drift. It sits inside `Projects/torchbearer/js/`, so #17 does not apply. `cap3` and `ord` stay in the page. *Torchbearer Phase 2, increment 1.*

**#92. `defer(fn, ms)` is the combat engine's clock, and the page owns the wait.** Every former `setTimeout` is `this.defer`; the module's runs `fn` at once so monster turns resolve synchronously, the page's is `setTimeout`. `aiStep` returns `{action, wait}` so pauses are assertable. A promise-based turn loop was rejected. *Torchbearer Phase 2, increment 2.*

**#93. `start` takes the party and flags as arguments; party builders are exported.** `Combat.start(encId, adv, {party, flags, onVictory, onDefeat})` replaces reading `App`. Flags are mutated by reference (`surprise-round`, `fatigued-start` deleted) so a consumed flag stays consumed. `heroCombatant(ch)` and `companionCombatant(id)` moved into `js/combat.js`; grid markup is the page's `mount()` hook. *Torchbearer Phase 2, increment 2.*

**#94. Reactions run on one bus called `trigger`, not `emit`.** `Combat.trigger(name, ctx)` offers each trigger in initiative order to combatants with `reactionUsed === false`, resolving before the triggering action completes. Triggers: `move-out-of-reach`, `manipulate`, `incoming-damage`, `incoming-attack`. `emit` was already the event seam (#89). Reactions change outcomes by mutating `ctx` (`dmg`, `acBonus`). *Torchbearer Phase 3.*

**#95. A combatant with more than one reaction is asked; one reaction is not a choice.** `askReaction(cb, id, ctx)` is a seam (yes in the module, `confirm` in the page), called only when `reactionsOf(cb).length > 1`, e.g. a fighter's Reactive Strike vs Shield Block. It must be synchronous, as in #92. `play-games.mjs` accepts the dialog. *Torchbearer Phase 3.*

**#96. `reach` and `reactions` are monster data, and the validator rejects an unknown reaction id.** `"reach": 2` is in cells (default 1). Unlike `special` ids, an unknown reaction is an error, since a reaction that never fires makes a fight quietly easier. `smoke.mjs` asserts `Object.keys(REACTIONS)` equals `KNOWN_REACTIONS`. *Torchbearer Phase 3.*

**#97. The Forge-Tyrant is the first and only monster to threaten a square.** The Large boss of `packs/embers-of-the-hold.json` got `"reach": 2` and `"reactions": ["reactive-strike"]`. Bell of Barrowmoor and Thornwake Vigil were left alone because that is an unmeasured balance change; it stays in the standing backlog. *Torchbearer Phase 3.*

**#98. A foe can die mid-turn, so `aiStep` ends a dead foe's turn.** The guard `if(this.active && !foe.dead) this.endTurn()` froze the fight when a foe died mid-turn; it is now `if(this.active) this.endTurn()`, and flee provokes like any Stride. A monster's Reactive Strike zeroes its `mapCount` and restores it. *Torchbearer Phase 3.*

**#99. Hide and Seek are their own verbs, not `resolveTargeted` cases.** Hide is one Stealth roll compared against every observer's Perception DC. Seek is a Perception roll over a burst, armed as `kind:"cell"` and handled in `cellClick` before `castAt`. The per-pair detection map gives per-foe answers from one roll. *Torchbearer Phase 4.*

**#100. Detection is four states, and the two conditions are the base under the map.** `detect[observerId][targetId]` holds `"concealed"`, `"hidden"` or `"undetected"`; absence falls back to the target's conditions (`invisible`, `concealed`). Writing `"observed"` deletes the override. `undetected` cannot be targeted; `hidden` pays DC 11, `concealed` DC 5, and a failed flat check still spends the action and raises MAP. *Torchbearer Phase 4.*

**#101. Cover is +4 or +2 off the same Bresenham walk, and does not stack with Take Cover.** `coverBonus(a, b)` re-walks `losClear`'s line: wall +4, living body +2, corpse nothing, endpoints ignored. No corner rule. `effAC` takes the larger of cover and Take Cover; the raised shield's +2 still stacks. *Torchbearer Phase 4.*

**#102. A monster's attack gets cover through `opts.from`, and #90 stays pinned.** Passing the whole foe to `effAC` would have silently enabled monster flanking. `effAC(target, attacker, opts)` reads `opts.from` for geometry and the stub for everything else. *Torchbearer Phase 4.*

**#103. A `bonus` carrying `vs` is collected as `condBonuses`, and exactly one site reads it.** `finalizeCharacter` now lists conditional bonuses; only `Combat.seek` reads `{"target":"perception","vs":"seek"}` (Sensate Gnome's +2). General wiring is Phase 5's row: the seam is built, the wiring is not. *Torchbearer Phase 4.*

**#104. Hiding survives nothing, because there is no Sneak.** A hidden creature that moves (`afterMove`) or Strikes (`afterAttack`, hit or miss) drops every `"hidden"` naming it. The reveal falls back to the condition base (#100). Guide §13 states the simplification. *Torchbearer Phase 4.*

**#105. `distracting-shadows` becomes a wired hook; `very-sneaky` stays a note.** Lesser cover is not enough to Hide behind, which gives Distracting Shadows its value; it moved to `{"special":"distracting-shadows"}`, making guide §8's list 42. `very-sneaky` is about Sneak and `trap-finder` has no traps, so both stay inert. *Torchbearer Phase 4.*

**#106. A maneuver's DC is `10 + the target's save`, and Demoralize keeps its extra `+ CHAR_LEVEL`.** Trip, Shove, Grapple, Disarm and Escape use the plain PF2e form already used by Feint and Hide. Correcting Demoralize is a balance change to the shipped adventures, so it waits. *Torchbearer Phase 5.*

**#107. Grapple's Escape DC is the total that made the grab.** Mirrors `stealthDC` reading back the Hide total, so a crit grab is harder to escape without a second condition or `restrained`. Stored as `grabDC` and printed in the Chronicle. *Torchbearer Phase 5.*

**#108. Aid rolls Athletics against a flat DC 15, whatever it aids.** Preparing is one action; the roll happens when the ally's next check does. Plumbing the skill through six call sites was rejected. `cooperative-nature`'s +4 applies to that roll. Guide §13 names the simplification. *Torchbearer Phase 5.*

**#109. A readied action is not a reaction id.** Ready arms one Strike on `move-out-of-reach` read backwards (entering reach) and lives on `cb.readied`, not in `REACTIONS`. Otherwise `KNOWN_REACTIONS` would validate `"readied-action"` on a monster that could never fire it. It still spends the one reaction. *Torchbearer Phase 5.*

**#110. Torchbearer gets its own CI workflow, and the site-wide CI row stays open.** `.github/workflows/torchbearer-ci.yml` is one job, one `node` call, no browser, shaped like `fourth-quarter-ci.yml`, after five PRs ran 947 assertions only locally. It does not close BACKLOG rank 78. *Torchbearer Phase 5.*

**#111. The engine grows past level 3, to 10, and the level is the hero's.** Answers Q19. `build.level`, read through `levelOf`, drives every sheet; `CHAR_LEVEL` is only the forge level; `MAX_LEVEL` is 10 and `repairBuild` clamps into 1..10 rather than refusing (#36). Ten is where spell ranks run out (#114). *Torchbearer Phase 6, increment 1.*

**#112. A class's `featLevels` list is authoritative up to its highest entry; the Player Core standard row takes over above it.** `extendTable` splices the truncated class rows onto the table in `rules.js`, so seven classes needed no change. The Rogue's lists are spelled out to 20, with new optional `skillIncreases`. *Torchbearer Phase 6, increment 1.*

**#113. `migrate` decides a version-2 save's level; `repair` shapes a version-3 one.** A `__v: 2` blob claiming `level: 7` loads at 3; a `__v: 3` one loads at 7 (#37). Levels 1 to 3 stay in flat fields (`feats`, `skillIncrease`, `boosts`); `build.advances` starts at 4, and v2 migrates to an empty map. The `sera-voss` fixture stays v2. *Torchbearer Phase 6, increment 1.*

**#114. Spell ranks 3+ are not modelled; slots are the class's level-3 row moved by the Player Core table.** `build.spells` has `r1`/`r2` and the pack's 42 spells stop at rank 2. `spellSlotsAt` grows rank 2 to 3 at level 4 and stops. The class `slots` field is still read. *Torchbearer Phase 6, increment 1.*

**#115. Boosts past +4 are partial, the level-1 cap stays, and Master waits for 7.** `abilityMods` keeps `Math.min(4, ...)` on the level-1 set; boosts at 5, 10, 15, 20 apply on top with the Remaster partial-boost rule. A skill increase raises one rank, with `RANK_FLOOR` holding Master to 7 and Legendary to 15. *Torchbearer Phase 6, increment 1.*

**#116. A level is 1,000 XP, the counter resets, and an adventure without `awards` is worth a level at its ending.** `App.xp` counts toward the next level; `levelUp` subtracts 1,000. An `awards` map pays per encounter id and `"ending"`; an empty `{}` pays nothing. Paid keys are stored as `awarded:<key>` in the save's flags so nothing pays twice. `gameover` pays nothing. *Torchbearer Phase 6, increment 2.*

**#117. The level-up is a mode of the builder, and a slot with nothing to offer is satisfied empty.** `Builder.openLevelUp` clones the build and writes only `build.advances[level]`; `App.hero` is untouched until confirmed, and XP is spent in `App.levelUp`, which also rests. `advanceMissing` ignores a slot whose `featChoices` is empty, since the core pack's feats run out. *Torchbearer Phase 6, increment 2.*

**#118. Kit runes follow the level: +1 potency from 2nd, striking from 4th, +2 potency from 10th.** `kitAt` applies them to every hero weapon, including ranged and unarmed, not companions. There is no shop until Phase 7. `kitAt(3)` is `{potency: 1, striking: false}`, so every Phase 1 pin holds. *Torchbearer Phase 6, increment 2.*

**#119. Encounter scaling reads the hero's level, and the promise is correct-feeling PF2e from level 3 to 10.** Foes take inclusive `minLevel`/`maxLevel` beside `minParty`; `start` reads the highest sheet level (0 if none). The validator requires whole numbers of 1 or more (`"minParty": true` used to spawn nothing) and rejects `minLevel` above `maxLevel`. Guide §13 was rewritten. *Torchbearer Phase 6, increment 2.*

**#120. A campaign entry is an object, never a bare adventure id.** `"adventures": [{"adventure": "barrowmoor"}, ...]`: one shape, one validator branch, one schema entry, and room for `"if"` and `"locked"`. Reversing it is a normalizer in `entriesOf`. *Torchbearer Phase 7, increment 1.*

**#121. Campaign flags are the same grammar in a second scope.** A flag with `/` (`barrowmoor/bell-answered`) reads the campaign record; one without reads the adventure's map. `flagOk(expr, local, campaign)` in `js/campaign.js` is the only reader. One global flat map was rejected. Flags fold into the record under the adventure id at its end, minus `awarded:` keys. *Torchbearer Phase 7, increment 1.*

**#122. `SAVE_VERSION` stayed at 3 for Phase 7's three new fields.** `campaignId`, `campaignFlags` and `completed` are additive, and their pre-Phase-7 value is the "no campaign" `repair` already computes. Per #37, a bump would buy an empty `migrate` branch. *Torchbearer Phase 7, increment 1.*

**#123. One campaign record per save.** Starting a different campaign or a one-shot forgets the current record after a confirmation. The record survives when its pack is not loaded, so reloading the pack resumes it. *Torchbearer Phase 7, increment 1.*

**#124. Money is counted in copper pieces, and a price is a string.** `gold`, item `price` and every sum in `js/shop.js` are integer copper, because fractional gold drifts. Authors write `"price": "1 gp, 5 sp"` and `parseCoins` converts at validation. A bare number is rejected as ambiguous by a factor of 100. *Torchbearer Phase 7, increment 2.*

**#125. An adventure may hand out one hero's quarter share of PF2e's Treasure by Level, enforced by the validator.** Level 3 caps at 125 gp, not 500. The sum is across every scene, not one path, so no playthrough can exceed it. It is an error because the symptom is silent. Adventures without `level` are unchecked. *Torchbearer Phase 7, increment 2.*

**#126. A fight's opening state is a table, and the flags stay flags.** `OPENERS` in `js/downtime.js` has five entries keyed by flag; `combat.js` reads their fields and `registry.js` validates keys. Existing `"onEnter": {"flag": "surprise-round"}` keeps working, openers are consumed per encounter, and a misspelling like `suprise-round` is now an error. *Torchbearer Phase 7, increment 3.*

**#127. A day is the unit of downtime, and every activity costs exactly one.** This keeps Treat Wounds from being free and makes Craft a decision; Crafting is four days minimum. The count is `days` on the save, additive, so `SAVE_VERSION` stays at 3 (#122). Downtime is between adventures only: Camp is disabled while `App.adv` is set. *Torchbearer Phase 7, increment 3.*

**#128. An unreachable scene is a validator error, and the walk lives in the validator.** `sceneGraph` in `registry.js` walks from `start` and names every orphan. It is in the validator because a check that has to be run on purpose does not run. The walk includes the engine's implicit `c.defeat||"gameover"` edge. *Torchbearer Phase 7, increment 3.*

**#129. The pack contract has one source, and the servable copy is generated.** The source is `js/schema.js`, imported by the engine; the validator reads its `required` arrays via `extraRequired()`, and `packs/schema.json` is generated by `node tools/schema.mjs --write` and committed. A JSON file could not be the source because boot must not depend on a fetch. `smoke.mjs` fails on disagreement and checks every declared field appears in engine source. *Torchbearer Phase 8.*

**#130. A one-branch check and an encounter nothing starts are validator errors.** A choice with only `success` sends failed rolls to `undefined` ("Missing scene"). An unstarted encounter is unreachable work. The encounter set is the pack's, not the adventure's. Same reasoning as #128. *Torchbearer Phase 8.*

**#131. Unknown pack fields stay legal, and the tooling reports them anyway.** The engine keeps guide §1's promise; `authoring.html` lists every key no `$defs` entry names, with the nearest field, as a note. `_`-prefixed keys are never reported. `shieldHP`, `perTarget` and `composition` are read by nothing and deliberately left out of the schema. Logic is `unknownFields` in `js/inspect.js`. *Torchbearer Phase 8.*

**#132. A scrollable flex column centres its children with `safe center` or not at all.** `#screen-title` (`overflow-y:auto` plus `justify-content:center`) put its top buttons at y = -47, unreachable, with 1,531 Node assertions green; `npm run games torchbearer` caught it. `play-games.mjs` now measures the title screen top with the whole Shelf loaded. Applies to every page in the repo. *Torchbearer Phase 8.*

**#133. Absalom writes its own reaction seam, using Torchbearer's names.** Answers Q18: per #17, Torchbearer's `combat.js` was re-implemented, not imported. The shared vocabulary is `move-out-of-reach`, `incoming-damage`, `incoming-attack`, one reaction per actor per round, no refiring. Absalom's reactions are pack `commands` entries with `triggers` and `effect`. *Absalom Phase 1.*

**#134. The Vault Keeper carries Reactive Strike, and the Fighter's own copy fires zero times.** `world.planApproach` Strides to the cheapest adjacent square, so creatures never leave reach (0 over 3,032 Strides, 0 Reactive Strikes in 2,000 runs). A creature owner makes it fire in play; balance unchanged at 79.8%. The zero is asserted. The suite walks `world.planApproach` itself; reach is `reachFeet`, default 5. *Absalom Phase 1.*

**#135. A reaction fires without asking.** Each Absalom build owns one reaction and declining either shipped one is strictly worse. A prompt would need an `await` in a rules path, and nothing in these rules waits. The first real choice needs `askReaction` (see #95); the backlog says so. *Absalom Phase 1.*

**#136. `incoming-attack` ships with no owner rather than an invented feat.** No 1st-level Fighter or Wizard reaction fits. The point fires at both Strike sites, the validator accepts it, and `smoke.mjs` proves it with a synthetic `riposte` in a cloned pack. A `ward` effect with no owner was rejected on #131's argument. *Absalom Phase 1.*

**#137. The encounter ending ends every condition.** Durations tick on turn boundaries, which do not exist outside an encounter. `endCombat()` clears the PC's and every living creature's conditions with a line each; `checkDisengage()` does the same for one creature that settles mid-fight. A real exploration clock was rejected. *Absalom Phase 2, increment 1.*

**#138. `game.js` rolls exactly one d20, and `smoke.mjs` counts them.** Every check goes through `roll(actor, kind, bonus, dc)`, which adds `modifiersFor(actor, kind)`. The suite strips comments from `game.js` and fails on a second `check(`. Exception: the persistent-damage flat check uses bare `die(20, rng)`, since flat checks take no modifiers. `turn.shielded` was deleted. *Absalom Phase 2, increment 1.*

**#139. The condition catalogue is closed, and `inflicts` is content's only door into it.** `conditions.js` names three; `content.js` rejects a fourth. Packs apply one with `{ condition, value, on }`, `on` being `hit`, `crit` (attacker's degree) or `crit-fail` (target's save). Homebrew Breathe Fire and critical Basalt Fist ship, measured in band (64.5% to 65.3%, 79.8% to 79.3%). *Absalom Phase 2, increment 1.*

**#140. The same-type bonus rule is written before anything needs it.** Per Player Core p.443, only the best bonus and worst penalty of each type apply; untyped ones stack. Today's catalogue cannot tell summing from the real rule, but two status penalties would silently double. Asserted against a hand-built bag holding two frightened, which a hand-edited save can contain. *Absalom Phase 2, increment 1.*

**#141. Nine modifier kinds, one per number the engine rolls or sets.** `attack` split into `attack-str`/`attack-dex` (enfeebled vs clumsy), `save` into `save-fort`/`save-ref`/`save-will`, plus new `damage` and `spell-dc`. Commands and creatures name their attack ability, defaulting to `str`. Rejected: a context object to `modifiersFor`, which `MODIFIER_KINDS.includes()` cannot validate. *Absalom Phase 2, increment 2.*

**#142. `game.js` rolls damage in exactly one place, and the source is not optional.** `damageFrom(actor, spec, source)` is the only `rollDamage(`, counted by `smoke.mjs`. `source` is `weapon`, `spell`, `persistent` or `healing`; only `weapon` takes a modifier. Required, not defaulted, because a caller allowed to omit it guesses. Damage floors at 0. *Absalom Phase 2, increment 2.*

**#143. A condition applied by content gets its duration from the catalogue, not the pack.** `applyInflict` reads `defaultUntil`: off-guard is `self-start`, clumsy/enfeebled/stupefied/slowed are `self-end`. A pack-written duration would eventually be forgotten, leaving a permanent -2. Action counts are read after the actor's start boundary so slowed bites. *Absalom Phase 2, increment 2.*

**#144. Immunity is a content list against a condition trait, and a refusal is a log line.** A creature lists `"immunities": ["mental"]`, conditions carry `traits`, and `applyCondition` refuses before touching the bag, naming the trait aloud. The trait list is closed at one entry so a second arrives as a load error, not a typo. *Absalom Phase 2, increment 2.*

**#145. `inflicts` may be a list, and two entries naming one condition are a load error.** A bare object still validates as a list of one. Duplicates are refused because `addCondition`'s higher-value-wins merge would silently drop one. *Absalom Phase 2, increment 2.*

**#146. A command may end a condition, and Rousing Splash rolls for it.** `ends: { condition, flatDC }` removes a PC condition outright or on a flat check; Rousing Splash rolls DC 10 against persistent fire's DC 15 (Player Core p.409). `autopilot.mjs` gained a `self-heal` branch reading `ends` off content: previously the spell was never cast in any balance number. *Absalom Phase 2, increment 2.*

**#147. An assertion whose comment claims more than its arithmetic can see is a failed guard-rail; the fix is often the comment.** Three of 35 deliberate breaks left the suite green. Two were bad tests; the third (off-guard plus Shield "proving" the same-type rule) was true but unobservable, so the assertion now says so. Extends #34. *Absalom Phase 2, increment 2.*

**#148. A template is a shape, and terrain is somebody else's business.** `js/templates.js` maps squares to squares, stateless, never importing `world.js`. `world.reachableFrom(ox, oy, squares, gateOpen)` is where shape meets room; `game.templateSquares(cmd, target)` feeds both resolution and `render.js`'s preview, after a duplicated cone hardcoded `feet > 15`. `smoke.mjs` fails on `Math.atan2` in either file. *Absalom Phase 3.*

**#149. The cone is the rule's quarter circle snapped to eight directions, and it is not the same size in all of them.** Snapping uses slope `1 + √2` at 22.5° octants; range uses `feetBetween`'s 5/10/5. Result: 11 vs 12 squares at 15 ft, 34 vs 36 at 30, 116 vs 120 at 60. The asymmetry is kept; the suite writes the 15-ft set out literally. *Absalom Phase 3.*

**#150. Line of sight and line of effect are two questions, and the gate separates them.** `blocksSight(x, y)` takes no `gateOpen`; `blocksEffect(x, y, gateOpen)` stops at a shut gate, and `hasLoE` filters every template and `unerring` command. One Bresenham `traceLine` takes the predicate. Pillars now shadow areas too. *Absalom Phase 3.*

**#151. A command no build ever casts fails the balance run.** `balance.mjs` counts per-build casts of each non-reaction command and exits non-zero on any zero. Forced by three silent failures, including Phase 3's new spells cast zero times and then Shield dropping from 4,143 casts to 0 while the win rate rose. *Absalom Phase 3.*

**#152. An area command must be a spell.** Its basic save rolls against the heir's spell DC, the only save DC the engine has, and `stupefied` moves it. A bomb written as a `burst` would borrow that number. `content.js` refuses it at load. Amended by #157. *Absalom Phase 3.*

**#153. An emanation and a burst of the same radius are one shape here, and the suite says so.** Every actor occupies one square, so `emanationSquares(o, f)` is `burstSquares(o, f)`; targeting differs in `game.js`. `smoke.mjs` asserts equality at four radii so a Large creature fails a test. Square-centre measurement is a documented departure from the book. *Absalom Phase 3.*

**#154. A number that makes the policy wrong is a content bug, and the harness can say which is wrong.** Warding Pulse costs one action (at two, Shield measured zero casts over 2,000 runs) and rolls flat 1d4 (82.8%) not 1d4+2 (86.7%, near the 90% ceiling). When policy and content disagree, measure both sides. *Absalom Phase 3.*

**#155. The autopilot's own bad play is a measurement, and separating it from content is part of reporting a number.** Of the wizard's 60.8% to 82.8% move, 13 points came from `combatPolicy` casting Shield only at MAP 8+; widening that alone gave 73.8%. Pre-Phase 3 win rates are floors. When a phase moves a balance number, the handoff owes the split. *Absalom Phase 3.*

**#156. A creature's policy is a pure ranking over measurements the engine already made.** `js/ai.js` takes a view and returns a choice: no world, RNG or state. Geometry is measured by `game.js`/`world.js`, and the executor walks the plan that was scored. One `planApproach` and one `planRetreat` per turn, handed forward. *Absalom Phase 4.*

**#157. Amends #152. An area command carries either `spell` or its own `dc`, never both.** #152 meant to refuse a borrowed DC, not a second caster. A creature has no spell DC, so its ability writes one; the heir's spells use `spell`. Both at once is ambiguous and `content.js` refuses it. *Absalom Phase 4.*

**#158. A creature asks the reaction bus whether it would provoke, rather than knowing what a Fighter is.** `provokedBy()` builds the bus's ctx and calls `reactionBlocked()` for every square of a candidate walk. A policy-side copy would have to track reach, round budget, squares left and `requiresShield`, and would drift. *Absalom Phase 4.*

**#159. A skirmisher only leaves when leaving is free.** It Strides out of reach if that provokes nothing, Steps 5 ft (Player Core p.418) if it would, and otherwise fights. No expected-damage arithmetic, since a Step always beats eating the swing (#147). Result: the warden ends 20 ft from Vesper, 5 from Kessa. *Absalom Phase 4.*

**#160. An encounter-scoped budget is runtime-only, like a reaction budget.** A creature's once-per-encounter spend lives in `turn.used` beside `turn.reacted` and never reaches the save. A reload re-rolls initiative, so the budget belongs to the fight; conditions are saved because a reload must survive them. *Absalom Phase 4.*

**#161. A behaviour that changes how a fight reads without changing whether it is won is worth shipping, and the handoff says so.** Hit-and-run measured neutral (wizard 82.8% to 82.8%, fighter 80.8% to 81.2% over 2,000 runs) while lengthening fights. Do not tune a creature until it shows a number. #155 applied to a feature. *Absalom Phase 4.*

**#162. A creature ability is content only a creature can reach, so the harness listens for it.** `balance.mjs` fails a run where any creature ability never fired, as #151 does for commands. It counts the engine's own `ability` event rather than guessing. *Absalom Phase 4.*

**#163. A guard-rail swept only at the shipped value can be sweeping nothing.** Deleting `planRetreat`'s still-in-reach refusal left the reach-5 sweep green; reach-10 failed on 131 of 6,051 retreats. When an invariant depends on a parameter, sweep a value the shipped content does not use. *Absalom Phase 4.*

**#164. A seeded harness gets a golden file, not an error bar.** Runs use seed `0x5EED + i`, so comparison against `test/baseline.json` is exact and skipped if run counts differ. Remaining tolerances (3 pts win rate, 3 pts deaths, 15% damage taken) are about what is worth stopping for. A retune answers with `--write-baseline` in the same commit. *Absalom Phase 5.*

**#165. A metric that stops accruing when the run ends cannot measure how lethal the ending is.** Damage taken truncates at death: a Keeper fist bump cost 10.4 pts of win rate but moved damage by 1.8 (tolerance 1.9), while deaths moved 10.3. Pair per-episode numbers with a batch-wide one. *Absalom Phase 5.*

**#166. Measuring a cause is a flag, not a script.** `--variant name={json}` applies an RFC 7386 merge patch to the raw pack and loads it through `loadPack`, printing columns side by side. Replaces a throwaway script written three phases running; invalid variants are refused rather than measured. *Absalom Phase 5.*

**#167. The harness needs its own guard-rails, hung off a pure seam.** `encounterRows`, `areaRows`, `summarise`, `compareToBaseline`, `mergePatch` and `parseVariants` take and return data, so `smoke.mjs` tests them with hand-built batches; nine were broken on purpose. Key catch: encounter deaths divide by all runs, so the column sums to the defeat rate. *Absalom Phase 5.*

**#168. A field two things must agree on has no default.** Every `pcOptions` entry must carry three `#rrggbb` prism faces, validated at load, with no fallback in `render.js` or the picker. A renderer default once drew Wizard and Fighter as the same blue prism for two rounds past 1,038 assertions. *Absalom Phase 8.*

**#169. A branch nothing can reach is worse than a rule that refuses.** An area's hint bar line is required on any area a stairway leads into, so `transitionTo()` needs no fallback; the start area has none because `intro.hint` covers it. An optional field would ship an unexecutable default branch, #151's failure again. *Absalom Phase 8.*

**#170. A mapping with an `else` will be wrong about the next case.** `ui.js` styled every unknown log kind as a dice roll. It is now a table, and an unknown kind renders unstyled, the case a save from a newer build actually reaches. *Absalom Phase 8.*

**#171. A refusal is an answer, and a keyboard has to hear it.** A number key that did nothing covered six reasons. `commandBlocked()` returns a one-word reason; `ui.js` owns the sentences exhaustively and falls through to the raw reason, never silence. *Absalom Phase 8.*

**#172. A browser test that seeds a save has to respect the autosave.** A state written while a coalesced autosave is pending gets overwritten when `pagehide` flushes before reload. gvb-save's flush is a no-op when clean, so waiting out the timer is the fix. A test writing a page's storage races its write path. *Absalom Phase 8.*

**#173. A knob nobody reads is a promise the engine does not keep; delete it, do not document it.** `tuning.standardDC` was loaded but never consumed, and per-area tuning would have multiplied it. It is gone, and tuning is a closed key list: unknown keys are refused with the legal ones named. *Absalom Phase 6.*

**#174. Two names for one thing is a slot the wrong save gets written to.** `main.js` refuses a pack whose manifest name and `pack.id` disagree, since `save.js` keys slots on that id. The manifest's `file` is a bare filename resolved beside the manifest; a path is refused. *Absalom Phase 6.*

**#175. A reward is a field on content the engine already parses, not a new kind of square.** A pickup tile would cost `render.js` a colour and `ui.js` a sentence. Instead `restore` (the gate seal's three keys) moved onto `lore`, so a pillar can restore hit points, spell slots and focus. *Absalom Phase 6.*

**#176. A stairway you land on is a stairway you immediately take again.** A `to` pointing at a `stairs` tile makes `checkTriggers` fire `checkStairs` on arrival, looping forever. An arrival square must be plain floor. The bug in an N-of-something feature is rarely in the second one. *Absalom Phase 6.*

**#177. A command cannot target something the engine has no word for.** `sideOf()` answers only `"pc"` or `"foe"`, so `heal-other` could only reach enemies; a party is a new turn-order model. Phase 7 built `buff` (onto the heir) and `debuff` (onto a creature) instead, naming the missing noun. Reversible once there is a party. *Absalom Phase 7.*

**#178. Two kinds that do one thing is worse than one kind that does it properly.** `self-buff` hardcoded `shielded`, `cmd.acBonus || 1` and a duration in `game.js`. `buff` replaced it with `applies: { condition, value }`, duration from catalogue `defaultUntil`, and a load refusal for any condition not marked `helpful`. *Absalom Phase 7.*

**#179. A closed vocabulary needs the entry the new kind actually wants.** `INFLICT_ON` (`hit`, `crit`, `crit-fail`) would fire a `debuff` about one time in five. `"fail"` now means failure or worse, mirroring `hit`. A vocabulary sized for one shape refuses the next by working. *Absalom Phase 7.*

**#180. The condition a rider keys on is content, not a rule.** Sneak attack is `precision: { damage, when }`, with `when` any unhelpful condition, rather than a hardcoded `"off-guard"`. Precision doubles on a crit and rolls under its own `damageFrom` source so enfeebled is not charged twice. *Absalom Phase 7.*

**#181. A field resolved in one place is resolved in only one of the places that need it.** Per-build `startingInventory` resolved in `selectPc` passed Node tests, but `main.js` calls `freshRun` with the unresolved pack first. A browser assertion on the inventory panel found it (#39), plus a frozen reload on a creature's turn: `pumpEnemies` never started on boot. *Absalom Phase 7.*

**#182. A room is a description, and the same-room check is a dump of the old one, not a re-implementation.** `layout.js` holds pure numbers and derives seats, colliders and `inBounds()`; `world.js` converts to `THREE.Box3`. Verified against `test/fixtures/corner-tap.json`, dumped from the old `world.js`: 30 seats, 11 boxes, nine stand-points, 5,037 `inBounds()` samples. Colliders derive from dimensions, not `Box3.setFromObject`. *Fourth Quarter Phase 1.*

**#183. Exported stand-points keep their identity across a rebuild.** `DOOR`, `PASS_FOOD`, `STOVE_STATION` and six more `Vector3`s are re-aimed with `.set()`; `ROOM` and `KITCHEN` via `Object.assign`. Consumers need not call `currentLayout()`. The cost: exports are mutable, and a module copying one at import would hold the Corner Tap's forever. *Fourth Quarter Phase 1.*

**#184. A pure-module phase in a three.js project still ships a browser check, under `tools/` when CI globs `test/`.** `tools/browser-check.mjs` asserts derived lists after boot, New Game and a dev warp. It caught a `st.ring` key/mesh collision that threw with 448 Node assertions green. It needs `playwright-core`, so it stays out of `fourth-quarter-ci.yml`'s `test/*.mjs` glob. *Fourth Quarter Phase 1.*

**#185. The ladder is physically bigger, and every rung is the Corner Tap's plan scaled until NPCs can path.** Fieldhouse, Midtown and flagship are 20×13, 24×15, 28×18 m (Corner Tap 16×11) with 44, 58, 76 seats, same bar-west/kitchen-north/door-south plan. Second rooms waited on Phase 3 pathing. `VENUES[].seats` is `seatsFor(LAYOUTS[id]).length`. *Fourth Quarter Phase 2, increment 1.*

**#186. A standing point can be walkable and still unreachable, so the invariant floods from the door.** `unreachable(desc)` rasterises the floor at 0.25 m, floods from within 1 m of the door, and names every unreached seat approach, station, idle-server and cook spot. A crate across the doorway strands the stove with six named problems. *Fourth Quarter Phase 2, increment 1.*

**#187. An upgrade's tier gate is on buying, not owning.** `UPGRADES[].tier` gates Premium Screens and the Craft Tap Wall to the Fieldhouse; `upgradeGate(c, id)` names the room and `buyUpgrade()` refuses. Saves that already own one keep it, its effect and its upkeep. The panel disables the button and names the room. *Fourth Quarter Phase 2, increment 1.*

**#188. What a description does not say, `world.js` derives; a shared texture keeps density by scaling UVs, not cloning materials.** Neon, corkboard, shelf, kitchen light and shadow cameras follow `stations` and walls. Floors scale UVs by size/16 against the Corner Tap's tuned `repeat`; cloning materials per room would double 66 MB of GPU texture per rung. *Fourth Quarter Phase 2, increment 1.*

**#189. Two grids, because they answer two questions, and they do not nest.** `unreachable()` keeps #186's point-sized sweep; `navGrid()` rasterises the same 0.25 m lattice with colliders inflated by walker radius. The nav grid is stricter at tables, looser at walls (patron 0.25 m vs player 0.3 m). One grid would force one radius. *Fourth Quarter Phase 3.*

**#190. A route that cannot reach its target is an answer, not an error.** `pathToward()` always returns a route, with `complete: false` and a path to the nearest reachable point; `pathBetween()` returns `null` instead. Nothing freezes on a failed plan: a patron with no exit route leaves from the nearest joined point. *Fourth Quarter Phase 3.*

**#191. Both ends of a route may be inside furniture, and the two boundary-crossing legs are never string-pulled away.** Cook spots, stools and DOOR_OUT sit inside inflated geometry. Targets snap to the nearest open cell within `SNAP_R` (1 m; exit 2.5 m) and the first and last legs are locked. *Fourth Quarter Phase 3.*

**#192. `freeSeat()` never offers a stool with no route to it.** `world.js` sets `reachable` on each seat from one nav-grid flood and `patrons.js` filters on it. The flag and the planner are asserted to agree on every stool in every room. *Fourth Quarter Phase 3.*

**#193. `validate()` carries the nav check, so a floor plan is authored against a body.** `navProblems(desc)` checks a 0.25 m walker reaches every seat approach, both passes, the exit, three idle-server and three cook spots. A crate leaving a 20 cm corridor slot passes the point sweep but blocks cooks; proven by reintroducing it. *Fourth Quarter Phase 3.*

**#194. A room is a list of rectangles, and nothing may name the hall and kitchen by hand.** `areasOf(desc)` returns hall, kitchen and optional `annexes`; `inBounds()`, `unreachable()`, `navGrid()`, shadow cameras, `floorBounds()`, `floorArea()` and `ceilingAt()` read it. Annexes carry their own ceiling height. No-annex descriptions still match the 5,037-sample fixture to 1e-9. *Fourth Quarter Phase 2, increment 2.*

**#195. An annex's shared edge sits exactly one wall thickness outside the hall, and its doorway band is derived.** A shared wall is a box built half a thickness out, fixing the annex edge at `room.x + wallT` (or equivalent); `validate()` refuses anything else. `annexBand()` derives the walkable band, overhanging 0.5 m each side. *Fourth Quarter Phase 2, increment 2.*

**#196. The hall's north wall is the kitchen's, and an annex may not open through it.** That wall carries the kitchen doorway, pass-through, shelf and bottles, drawn as brick boxes outside `wallSegments()`. `annexBand()` still computes a north band, so lifting the `validate()` refusal is one line. *Fourth Quarter Phase 2, increment 2.*

**#197. A second room is furnished by moving tables into it, not adding them.** The ladder stays 30 / 44 / 58 / 76 seats, asserted in two suites, and caps `beginNight()` arrivals. Midtown's back room took the hall's three east four-tops. Adding seats is a balance change and must be stated as one. *Fourth Quarter Phase 2, increment 2.*

**#198. A mezzanine is its own list on a description, not an annex with a floor height.** It sits inside the hall with a rail for edges, closed panelled ground beneath, and a stair on the hall floor. `floorYAt(desc, x, z)` stays single-valued so nav grid, sweep and player slide remain keyed by (x, z). *Fourth Quarter Phase 2, increment 3.*

**#199. One step rule, for two points and a distance, is the rail, the panelling and the stair's sides; none is a collider.** `stepBetween()` allows one riser (`STEP_H`, 0.18 m) or `MAX_SLOPE` 0.75 per metre, checked over both halves of the span. `inBounds()` (via `levelOpen()`), grid neighbours, flood, string-pull samples and `nearestCell()` share it. Suite uses a point-sized walker and says why (#147). *Fourth Quarter Phase 2, increment 3.*

**#200. A body's y is never integrated; it is read off the floor after every step.** `stepToward()` and the player's `slide()` set y from `floorY()`; stools, tables and rings sit on the floor. `STEP_H` is one riser, not the draft's 0.25 m, because a 22 cm one-frame server pop showed in the browser check. *Fourth Quarter Phase 2, increment 3.*

**#201. A first visit downloads the 1k textures; 2k is opt-in.** `pickTier()` in `js/textures.js`: `?tex=` wins, `saveData` forces 1k, and 2k needs dpr 2+, texture limit 8192+ and a backing store 2560+ device px wide. Everything else, including a dpr-3 phone at 1170 px, is 1k. Each threshold is pinned by a test. *Fourth Quarter Phase 4.*

**#202. Texture tiers are JPEG, the 2k files are untouched Poly Haven originals, and normal maps are 4:4:4.** KTX2 was unmeasured (no offline encoder; ~700 KB loader vs a 5 MB 1k set); WebP sat between JPEG 4:2:0 and 4:4:4. Normal maps at 4:4:4 q88 avoid half-resolution tangent channels. Re-encoding 2k to ~27 MB is left on the backlog. *Fourth Quarter Phase 4.*

**#203. The calendar is the schedule; the save carries only results.** Season, week, phase and tonight's games derive from the day number: 14 regular weeks, 2 bracket weeks, 14 dark nights, 126 days, Monday openings. `c.league` holds results, seeds, champions and generator state. `syncLeague()` keeps every past game played and none future; a record failing `validLeague()` is rebuilt from a day seed. *Fourth Quarter Phase 6.*

**#204. There is one result.** The Mules' hour-6 game rolls at league odds (`winProb`: 0.53 home, streak ±4 pts per game, clamped [0.2, 0.8]) and `settleNight()` passes it to `settleLeagueNight()`. Other games roll from the league's saved mulberry32 state. Broadcast, box score and standings hold no result of their own. *Fourth Quarter Phase 6.*

**#205. One Mules game a week, and the crowd reads what is on.** Slot rotates Thursday, Sunday, Sunday, Monday. `CROWD` in `league.js`: final 2.2, semi 1.9, Sharks 1.75, Mules 1.5, eliminated Mules 1.25, other playoff 1.3, other game 1.15, nothing 1. `forecast()` reads only `tonight(c).crowd`; `isGameNight()` means the Mules play. League Pass not ported. *Fourth Quarter Phase 6.*

**#206. The five teaching tools are archived, and `ARCHIVE.md` holds work that will not be done.** Devon, 2026-09-08: their rows, questions and Ownership entries moved verbatim to `ARCHIVE.md`; nothing deleted, pages and suites unchanged. `Tools/board-check/` and `Tools/prompt-builder.html` are not archived. The Name Picker rename (Q5) dies. FERPA rule stands. Reversed by moving rows back. *Teaching-tools archive pass.*

**#207. Who is in the bar tonight is arithmetic, not a stored roll.** `regulars.js` `dayRoll(id, day)` is one mulberry32 step off an FNV hash of id XOR day. Forecast, door, morning line and loyalty drift cannot disagree, and no reroll bug is reachable, so `regularsIn()` is safe in render paths. #203 applied to regulars. *Fourth Quarter Phase 7.*

**#208. Reputation opens at 50, because 50 is the identity.** `repMult()` = `0.6 + rep/125` (0.60x at 0, 1.00x at 50, 1.40x at 100); the End Zone opens at buzz 45 so it drags nothing. A new lever must not silently retune the game. Deliberate exception: `applicantSkillCap()` is 2 at rep 0, 4 at 50, 5 from 75. *Fourth Quarter Phase 7.*

**#209. The rival is a pressure, not a screen, and the drag has a floor.** The End Zone is one forecast multiplier, `1 - clamp((buzz - rep) * 0.003, 0, 0.15)`, plus a morning ticker line. Worst case draws 51% of base crowd (0.60 × 0.85). Buzz clamps 10-95 in `driftBuzz()`, +1 under 35, -1 over 80. *Fourth Quarter Phase 7.*

**#210. A regular at zero is remembered, not replaced.** Loyalty moves once a night, only in `settleSocial()`. A regular who showed and found their usual 86'd loses 8, once (the 86 is a `Set` of ids who showed). At zero they leave the roster; the door keeps six names, and a great busy night's new regular is half the time one of them returning. *Fourth Quarter Phase 7.*

**#211. A dark night is not a night anyone saw.** No reputation moves (running drift at service rate 1 raised it), every regular takes 6, nothing is minted, and the End Zone gets +1 before its drift. The 2D build charges the move at once (10 + 8 per night); per-night charging keeps a one-night move cheaper. *Fourth Quarter Phase 7.*

**#212. A regular comes through the door, and a full room holds them at it.** `NightEngine` takes `regulars`, queues the i-th at hour `1 + i % 3`, and seats them through the same `inBar < seats` gate ahead of walk-ins. Spawning regardless put a 31st body in a 30-stool room. A jumped clock walks every hour passed; with no regulars the walk-in draw sequence is unchanged. *Fourth Quarter Phase 7, inc. 2.*

**#213. The floor reports; the books decide.** The engine hands settlement three id lists (seated, found usual 86'd, comped); the books read only the comp, from `summary.comped`, never derived in `campaign.js`. Who showed stays the day's coin (#207), the 86 stays the shelf at close (#210); the floor's snub costs 0.02 mood and a ticker line. Two records of one fact drift. *Fourth Quarter Phase 7, inc. 2.*

**#214. The first round on the house: one per regular per night, $0 on the ticket, tip on shelf price, four loyalty.** Only a regular's unpaid first round while in the room. Tip is figured on what it would have cost. Four beats a good night's three. Interaction reach is 1.1 m against a station's 1.6, so standing at the taps comps the adjacent regular. *Fourth Quarter Phase 7, inc. 2.*

**#215. A card whose condition names a system this build lacks is not on the table.** "Warehouse Walkout" and "The Good Stuff Ran Out" need the 2D build's distributors. Porting them with `when` false forever hides a promise in a table. Nineteen of 21 cards shipped; `smoke-events.mjs` counts nineteen so the absence is a claim. They return with the distributor arc. *Fourth Quarter Phase 8.*

**#216. A moment is on the floor, the sim runs under it, and last call answers what the boss did not.** A card is a person or lit prop at a stand-point; E opens its choices in the management panel. The clock keeps running; Esc walks away. One card waits at a time. At last call an unanswered card resolves to its first option, marked `auto` ("ran its course"). *Fourth Quarter Phase 8.*

**#217. A choice is data; the floor reports; the books decide (again).** `resolveChoice()` returns `{ fx, line, cls }` and writes nothing. `engine.applyEffects()` spends what the night can now (cash to `eventNet`, mood, stock, `clearOut`, `staffQuits`) and carries the rest in `summary().moments`; `settleNight()` applies them and writes `eventCd`. A dead screen thins walk-ins to 70%, dead sound to 85%. *Fourth Quarter Phase 8.*

**#218. The inspector's nose is overstock.** This build has no lots (it rots a flat 15%), so "near-spoiled" means the walk-in holds more food than the forecast eats in two and a half nights. A per-lot shelf life is a later arc; this is the one line to change then. *Fourth Quarter Phase 8.*

**#219. The way to lose is the landlord, and the count is consecutive.** Answers Q23. A night whose books close below $0 is a missed night; three in a row lose the lease. One night in the black clears the count. Dark nights count. The threshold is zero because that is where the HUD already turns red. *Fourth Quarter Phase 9.*

**#220. Eviction drops you a rung; it does not end the run.** `evictLease()` walks `VENUE_ORDER` backward: move-in nights come due (at least one), gear with no wall comes off with its upkeep, regulars over the cap are pruned, and the till floors at $300 against the seized deposit. Only eviction from the Corner Tap sets `failed`. The run summary reads the high-water tier. *Fourth Quarter Phase 9.*

**#221. One `billsFor(c)`, because two copies of a sum are two answers.** `settleNight()` and `settleDarkNight()` had hand-written drifting copies of wages, rent and upkeep, and the lease check reads both. A theme is excluded (optional, open nights only). Bill assertions run on a campaign that owns gear, since one without upgrades cannot see a dropped upkeep line. *Fourth Quarter Phase 9.*

**#222. `strikes` and `failed` are additive, and an old save is not judged for nights under different rules.** `repairCampaign()` defaults zero strikes, not failed; strikes past the limit clamp rather than evict on load; only literal `true` is failed. `stats.bestTier` (floored at the current room) and `stats.evictions` join via the `stats` spread. No key change, no version bump (#36). *Fourth Quarter Phase 9.*

**#223. The crowd is sampled: at most 400 agents walk, each standing for `attendance / 400` people.** 3,000 guests times 120 `simulateDay` runs would turn a four-second suite into a minute. At 400 a 5% share is 20 agents, walk cost about 15 ms. The report carries `sampled` and `represents`; player counts are scaled, test counts (`arrivals`, `buyers`, `arrivalsByBlock`) raw. *Faire Weekend Phase 1, inc. 1.*

**#224. The walk has its own rng stream, and only aggregates reach the save.** `simulateDay` draws the crowd from `makeRng(seed ^ 0x9E3779B9)`, so every seed rolls its pre-phase events, pinned by a forty-seed fingerprint. `history` carries only the `guests` block of counts and ids, never a person. No key change, no version bump (#36). *Faire Weekend Phase 1, inc. 1.*

**#225. A stall a guest cannot afford pulls nothing, and that is the one purse rule.** A second till check guarded the same absence, so breaking either left the suite green (#34); it is gone. An invariant (purse plus spent equals arrived purse) catches negatives. `hungry` reads the meal count and archetype table, not the needs vector, since a test could not tell them apart (#147). *Faire Weekend Phase 1, inc. 1.*

**#226. A stall's gross is what guests handed over at it, and `computeFootTraffic` becomes the estimate.** `walkGuests` records `spentAt` per plot; `simulateDay` scales by `represents` and takes the house cut. Unreachable stalls earn $0, spent crowds stop buying, the 0.6x-1.6x band no longer caps. `computeFootTraffic` is the "est." forecast; `measureFootTraffic(arrivals, builtPlots)` is its measured twin on the report. *Faire Weekend Phase 1, inc. 2.*

**#227. The col-3 spur is disconnected on purpose, and building against it is refused with its own sentence.** The gap at (3,3) cuts the spur off from `ENTRANCE`; with walk-based sales a stall there earns $0. `isLegalPlacement` refuses any `PLACEMENT_RULES.requiresPathFrontage` kind with no finite walk to the gate. Terrain is untouched, existing plots are grandfathered and named in `unreachable`. *Faire Weekend Phase 1, inc. 2.*

**#228. `wristbandCut` 0.28 -> 0.12, because the number it multiplies stopped being a coefficient.** Real purses give about $26 a head to stalls; 0.28 tripled a developed faire's net and put the $25,000 win inside two weekends. Raising `perGuestCost` instead failed SIGNIFICANCE 3. Built-out faire net now +$8,980/day; empty field still -$1,177. Pinned by SIGNIFICANCE 10 on the ledger. *Faire Weekend Phase 1, inc. 2.*

**#229. The gate takes its share of the purse before a guest reaches a stall.** `spawnGuests(n, rng, ticketPrice)` records `arrived` and leaves `arrived - ticketPrice` to spend, so a dear ticket thins every purse, not just the crowd (max-price gate leaves stalls under 80% of the min-price per-head take). Keeps SIGNIFICANCE 3 a real two-force trade. *Faire Weekend Phase 1, inc. 2.*

**#230. `GUESTS.stepsPerBlock` 12 -> 6: walking has to cost the block, or gate distance costs nothing.** At 12 a far stall took the same $442 as one by the show; at 6 it drops to $351. 5 to 8 measure the same and the economy does not move. The suite's step check now compares against the network's diameter, not its size. *Faire Weekend Phase 1, inc. 2.*

**#231. Weather is a pure function of a per-save seed and the calendar, not a roll from the day.** `runDay`'s seed is drawn at gate-open, so a forecast from it would be a guess. `state.weatherSeed` is drawn once per save; `rollWeather(weatherSeed, season, weekendDay)` is stable, reload-safe and takes no draw from the day rng. `nextCalendarDay` models the rollover; the suite checks forecast against the arriving day. *Faire Weekend Phase 2.*

**#232. `createInitialState()` is deterministic; `newGame()` is the one function that draws a real seed.** A clock seed in the factory gave two fresh states different skies and broke paired tests. The factory takes a seed defaulting to a constant; `main.js` and the slot's `defaults` use `newGame()`; `repair` backfills the constant. Determinism asserts run under a clock stubbed to jump a minute per read (#147). *Faire Weekend Phase 2.*

**#233. The shade weight is what gets a ceiling, not the heat.** `blockQualityWeights` returns `sightline: 0.80 - shade`, so unbounded shade pays for no view and goes negative past heat 3.2. Clamping the weight keeps three non-negative weights summing to 1 for any table. `WEATHER_SHADE_CEILING` is 0.7, hottest authored 0.65; the suite asserts the gap both ways. *Faire Weekend Phase 2.*

**#234. The forecast is exact, one day ahead, with no fog of war.** Bands, probabilities and degrading accuracy were rejected: ticket price, campaigns, day-rate hires and the bill are committed the day before, so an unactionable forecast is decoration. Longer bets rely on the season's shape (#231). Future uncertainty belongs in a second, further forecast. *Faire Weekend Phase 2.*

**#235. A relationship leaves with the act.** `state.relationships` holds a number only for contracted acts: signing writes `RELATIONSHIP.neutral`, `releasePerformer`/`fireVendor` delete it, re-signing restarts at neutral. A surviving number grows the map forever and changes the question. `arcBeats` is not cleared, so story stays. `repair` fills entries only for acts under contract. *Faire Weekend Phase 3.*

**#236. An act's best block is the one their quirk favours, ties to the biggest crowd, compared as a multiplier, not draw times crowd.** Draw times crowd made the Afternoon (weight 1.2) everyone's best. `bestBlockFor` compares `effectivePopularity(perf, block) / perf.popularity`, ties to larger `weight`. Derived from authored data, so an arc's quirk change moves it. *Faire Weekend Phase 3.*

**#237. One quote for every contract; the quick picks are points on the negotiation grid.** `quoteContract(state, kind, id, terms)` is the only rate calculator: listed cost x arc rate x terms discount x relationship, floored at half list. `NEGOTIATION` discounts are tuned to match `CONTRACT_OPTIONS` (0.84 vs 0.85, 0.70 vs 0.72). The record stores `cancelFeeMult` and `label`; no fourth cost path. Deterministic ask, no haggling rounds. *Faire Weekend Phase 3.*

**#238. A packed house pleases the act and costs the crowd.** Overflow gives the act `+packedHouse` (2); the crowd already pays via a 0.15 quality drop near capacity and the stub warning. Cramming a popular act on a small stage is a real trade. Daily deltas stay small (-4 to +6) so a tier is a run of days. *Faire Weekend Phase 3.*

**#239. A beat fires on a tier, once per save, and waits without blocking the gates.** `pendingBeats` is a pure read: subject under contract, `when` names the current tier, not in `state.arcBeats`. The card waits on Backstage; gates open regardless. If the tier moves on it stops pending and returns if the tier does. Forced answers and auto-resolve (#216 in reverse) were rejected. *Faire Weekend Phase 3.*

**#240. An arc's changes live on the save, not the catalog, and a rate change re-prices the standing contract now.** `state.actTraits[id]` holds popularity/quality deltas, quirk override and rate multiplier; `performerFor`/`vendorFor` overlay it and all movable reads use them. `resolveBeat` is the one writer. A `rateMult` also multiplies the standing `dailyCost` in place. *Faire Weekend Phase 3.*

**#241. Renown is what cash does not measure, tallied once at the weekend boundary, and never goes down.** Only `nextDay` into `weekendEnd` moves `state.renown`, via `weekendRenown`: mood held (2 at 70, 4 at 85), acts in their third weekend+ (1 each, max 5), four+ plots with nothing torn down (1). Tenure ticks first. First runs land 24 to 32 by Weekend 6 (headliner 20, South Meadow 30). *Faire Weekend Phase 4.*

**#242. Winning does not end the run; closing the season is the player's call, with or without the win.** `closeSeason` is offered from the victory screen and the weekend-end desk at Weekend 6 or later, refused elsewhere. A missed season records `won: false`. Answers Q28. *Faire Weekend Phase 4.*

**#243. The carryover is the first thing to reach a save through `migrate`, and the tally is why.** Slot version 1 to 2, key unchanged (#36). `migrateSave` builds `carryover` as run 1 and credits `renown` once with the mood line earned from saved history; `repair` runs every load and would overwrite it (#37). Tenure and demolition lines are not guessed. The suite compares every original key. *Faire Weekend Phase 4.*

**#244. What crosses a closed season: renown whole, reputation as start plus half of what stood above it, and the acts' stories.** Cash, grounds, roster, contracts, relationships, schedule, campaigns and history reset. "Half the closing reputation, floored at start" carried nothing (half of 82 is 41 < 50). `arcBeats` and `actTraits` cross. Next weather seed is `nextRunSeed(seed, run)`, keeping `closeSeason` pure. *Faire Weekend Phase 4.*

**#245. A renown gate on a grounds tier sits on top of its weekend gate, and the fence hint names whichever is short.** `isExpansionUnlocked` reads both; tiers without `unlockRenown` are unchanged. South Meadow extends two rows south, since width is pinned by tests and the 710px column. Its connector stops at col 6 to keep the network diameter under 24 steps (col 4 made it 25). *Faire Weekend Phase 4.*

**#246. The plat column is the current tier's width, threaded from state, not the widest tier's.** `main.js` sets `--cols` on `#board` each render; `style.css` sizes the column as `fit-content(calc(cols x cell + (cols - 1) x 1px + 34px + 1.4rem))`. At 1280 the Home Grounds column went 710 to 525px, desk 517 to 702px. `--cols` defaults to 14. Answers Q30. *Faire Weekend Phase 5.*

**#247. The map is its tracks.** `.grounds-map` is `width: max-content` with auto margins. A block grid fills its container and painted its gap colour as a brown slab (187px at 1280, 445px at 1080). Auto margins centre it and resolve to zero when the map is wider, keeping the scroll origin at the west edge (#132). *Faire Weekend Phase 5.*

**#248. A table wider than the desk scrolls inside its own box; the page never scrolls sideways.** Every roster and schedule table sits in `.table-scroll` (`overflow-x: auto`). Five stages had made the Fair Floor 1,820px wide at 1280. The schedule `<select>` fills its column down to 7.5em; the unlock tag wraps. Shrinking selects to 80px was refused (four letters of a name). *Faire Weekend Phase 5.*

**#249. A width is not a pointer.** The 1080px breakpoint's 38px cell is gone; the cell stays 46px at every width. Touch sizes hang off `(pointer: coarse)`: 48px cell, 44px markers, 44px floors on the four button classes, slider and `<select>`s. The 720px block keeps its copies. Answers Q29. Playwright `hasTouch` resets on full-page screenshots. Scroll-shadow half superseded by #252. *Faire Weekend Phase 5.*

**#250. The phone HUD is 137px, not 191.** On 375x812 the sticky HUD took 191px (242 with long sky names). Below 720px the version line hides and six figures sit in a three-column grid at 1rem. It stays sticky (17% of screen) since cash and day are glanced at mid-scroll. The 820px tablet HUD (142px) is unchanged. *Faire Weekend Phase 5.*

**#251. The canvas paints the ground; the markers stay in the DOM, under the same transform.** `plat.js` paints terrain, rules, cartouche and compass on `.plat-canvas`; the marker grid keeps every `title`, focus target and the 25 `data-action` wirings, riding `mapview.js`'s transform (suite checks `trackTransform()` vs `cellToRect()`). `.terrain-cell` divs are gone. On coarse pointers `minScaleFor` keeps markers at 44px. *Faire Weekend Phase 6, inc. 1.*

**#252. How the map moves, and what it settles at.** Rest scale fits width, never above 1, never under the pointer floor. Drag pans with 6px slop and swallows the ending click; no pointer capture (it kills ghost buttons in Chromium). `touch-action: pan-y`; Ctrl/Cmd+wheel zooms; keys and three buttons. The sheet never scrolls sideways (supersedes half of #249). Pan/zoom are unsaved session state in `ui`. *Faire Weekend Phase 6, inc. 1.*

**#253. A build preview splices a candidate into the plots array and runs the day's own functions; it never re-derives them.** `previewPlacement` copies `builtPlots`, adds the candidate as `status: 'built'` with a vendor seated, and calls `computeGroundsDraw`, `computeFootTraffic`, `computeReachability`. It reports `drops` on neighbours too. The suite builds the previewed plot for real and matches the numbers (#34). *Faire Weekend Phase 6, inc. 2.*

**#254. Every sentence the map has goes into one readout under the sheet, and `title` stays the only place it is written.** `.plat-readout` is a `role="status"` region written on `pointerover` and `focusin`; ghosts show their preview, everything else reads back its `title`. Nothing clears it; skipped during drags. `placeAt` keeps the preview in `ui.readout` for one render. Proved by `tools/touch-readout.mjs` (`npm run touch`, 24 checks). *Faire Weekend Phase 6, inc. 2.*

**#255. The gate is a ceiling, and `baseOverhead` came down 300 to pay for the people who hold it.** `CREW_RULES.baseCapacity` is 550 guests through an unstaffed fence; extras are turned away with `turnedAwayPenalty` mood scaled by share. Early faires draw 95 to 320; developed ones 1,500+. Two gate crews add 1,300. `baseOverhead` 2,200 to 1,900 removes the double-counted gate staff. *Faire Weekend Phase 7.*

**#256. A crew is staff, not an act.** No relationship, arc beat or renown tenure; `contractedActIds` excludes them. Otherwise three gatekeepers on a season contract would farm the kept-act renown line (#241). *Faire Weekend Phase 7.*

**#257. The watch is priced against the crowd the player staffed for, not the one the sky delivered.** `simulateDay` computes `expectedCrowd` without weather or jitter, and `crowdExposure` reads it. This keeps weather out of the event pool. The Phase 2 check could not see a break (exposure 0 on its one-stage faire); Section 1l now asserts the invariant on a big enough faire. *Faire Weekend Phase 7.*

**#258. The crew ride the contract catalog as a third caller, not a third cost path.** `effectivePerformerCost` and `effectiveVendorCost` now call one `contractedCost(act, contract)`: record `dailyCost`, else catalog `cost`, else zero. `quoteContract` gained a `'crew'` kind; crew relationship reads neutral (x1). *Faire Weekend Phase 7.*

**#259. The crowd that cannot get near a stage counts against the mood, and the herald moves them.** Overflow now scores `OVERFLOW_QUALITY` 0.25 instead of being dropped from the average. Two herald drafts failed (evening out every block moved crowd away from the best acts; filling to the rail tripped crowding on 429 heads). Shipped: move `pull` of each block's excess into blocks with room, measured against `CROWDING_FILL`; no overflow means counts unchanged. *Faire Weekend Phase 7.*

**#260. `tests/smoke.mjs` Section 1g built fixtures with `schedule: {}` since Stage 19.** `assignSchedule` silently refuses unknown blocks, so SIGNIFICANCE 9 and 10 compared faires with nobody on stage, and passed because both sides shared the defect (#34). Fixtures now write `createInitialState`'s keys, and an assertion reads a scheduled act back off the day. Verdicts unchanged, numbers moved. *Faire Weekend Phase 7.*

**#261. The walk shell's bundle marker is a JavaScript comment, `/*SG-BUNDLE*/`, not an HTML one.** `<!--SG-BUNDLE-->` in `tools/walk-shell.html`'s module script is a SyntaxError that `check-integrity.mjs` flagged since #58. Changed in the shell and `export-walk.mjs`; the template rebuilds byte-identical. `test/export-walk.test.mjs` refuses HTML comments in the shell's module script. `npm run check` went from 2 broken units to 1. *School Generator, September 2026.*

**#262. A test that reads other tests as text lives in its own file, never in one of them.** `tests/wiring.mjs` checks each action name appears in `tests/smoke.mjs` and `Tools/board-check/play-games.mjs`. As a section of `smoke.mjs` it would read its own inventory as coverage forever. Binds anything that greps a suite. *Faire Weekend Phase 8.*

**#263. An audit that scans source for a pattern resolves the pattern's escape hatches rather than listing them.** `js/ui.js` interpolates `contract`, `contractCrew`, `hireVendor`; `tests/wiring.mjs` resolves the parameter off every call site. An unreducible interpolation fails by name, and any second interpolation site fails until resolved. *Faire Weekend Phase 8.*

**#264. An allowlist is checked from both ends or it is a comment.** Every `tests/wiring.mjs` allowlist entry must still be a real action, carry a reason longer than a name, have its selector present in the named suite, and still be needed, so the list can only shrink. #13 applied to exemptions. *Faire Weekend Phase 8.*

**#265. "Not interested" to Earl means a self-financed middle game, not Earl's office with a different opening line.** Option B from `Projects/daredevil/WISHLIST.md`. `_chapter_m2` routes `rels.earl === 'absent'` to `m2_solo_entry`; nothing resets it to `'backer'`, and the ending prints `'absent'`. The dead "hard man to reach" arms in `m2_entry_waited` were deleted. Session call, reversible by rerouting one arm. *Daredevil Phase 1.*

**#266. A card the branch requires is the only card until it is played, and the milestone button waits.** On the backer-less branch `renderHubFR2` shows `fr2_debt_01` alone, locks evenings behind it, and withholds Milestone 3. Otherwise `hubExhausted()` would offer the next chapter over an unplayed scene. *Daredevil Phase 1.*

**#267. On the backer-less branch the Vegas offer reaches Duke directly, and the Milestone 5 button reads `fr4_close` on the way out.** Vegas appears in scenes the solo branch cannot skip. `fr4_eve_california` replaces `fr4_eve_earl` by `rels.earl`, same three-way shape. The solo Milestone 5 button goes through `fr4_close`. Amended by #270 (both branches route both closes). *Daredevil Phase 1, inc. 2.*

**#268. Roy Petersen is the regional crew's cameraman on the solo branch, and Dot Kessler meets Duke off the ramp.** `m3_entry`'s solo arm introduces Roy so later lines read on both branches. Kessler takes Earl's place at Milestone 3 and the inferno tent; the fee envelope replaces the photograph speech. No new characters. *Daredevil Phase 1, inc. 2.*

**#269. "One last stunt: Earl picks" is hidden on the solo branch, not reassigned, and `m5_decision`'s option count counts.** The choice carries `_requires: ()=> !solo()`, leaving seven endings (six without Pete). The literal "Eight options" had been wrong for three rounds; it now counts the list. Legend career track still requires Earl (`showGameEnd`). *Daredevil Phase 1, inc. 2.*

**#270. Both Free Roam closes are read by both branches, and `_chapter_fr2` is deleted.** `fr2_close` and `fr4_close` had finished backer arms no run reached; both hub milestone buttons now go through them. `_chapter_fr2` was unreferenced and duplicated `m2_sign`'s stat update; its `m2Complete` moved to `m2_sign`. Three baseline transcripts moved. Amends #267. *Daredevil Phase 2.*

**#271. The signing sets the relationship it creates, and `pressAtFair` and `earlApproached` are cut rather than given a writer.** `rels.earl` and `m2Complete` lived on `m2_round3_cal`, so Cal's-tell runs signed with Earl `'unknown'` and broke `currentHubRoute()`; they now live on `m2_sign`. `pressAtFair` guarded lines about a nonexistent fair press man; `earlApproached` had nothing behind it. Both removed. *Daredevil Phase 2.*

**#272. The ending Earl picked is its own outcome, and the retrospective says whether Duke made it.** Outcome scenes set `last_stunt_win`/`last_stunt_loss`, so `m5Outcome === 'last_stunt_earl'` never fired. `m5StuntFlags()` reads `m5Decision`; `m5StuntCleared` carries whether he cleared it, read by the retrospective's third line. *Daredevil Phase 2.*

**#273. One relationship label table, in `state.js`, and the ending's wording wins.** The stat panel and ending screen had drifted labels (e.g. `backer` as "Business Deal", no Pete or `hanger_on`). `REL_NAMES` and `REL_STATES` are exported from `state.js` and read by both. The suite moves one entry and watches both screens change. *Daredevil Phase 2.*

**#274. A flag read by nothing and a flag written by nothing are both bugs, and `flags.mjs` counts them; the existing twenty-eight are frozen, not fixed.** The audit reads `engine.js` and `scenes.js` as text, resolves every `flags:` site (#263), and checks read-without-writer, false-default-without-writer, untouched defaults and the write-only list. That list of 28 is checked from both ends (#264). Own file per #262. *Daredevil Phase 2.*

**#275. Daredevil seeds `rels.pete` as `'unknown'`.** Every guard that read `undefined` as "thread never opened" was checked: prose closures and both ladders test `pete && pete !== 'absent' && pete !== 'unknown'`, and the two mentor-ending tests now read `isPresent('pete')`. `'unknown'` and `undefined` answer every test the same way; older saves get him through `repair`. *Daredevil, arc one Phase 3.*

**#276. The cast table lives in `js/cast.js`, a leaf below `state.js`.** `save.js` must read `CAST` to seed and repair, and `state.js` imports `save.js`, so putting the table in `state.js` would create a circular import. `cast.js` imports nothing and `state.js` re-exports it; Phase 2's `REL_NAMES`/`REL_STATES` folded in as one table per character. *Daredevil, arc one Phase 3.*

**#277. Route tables carry their own order; Milestone 5 keeps Ruthie before Cal.** `routeByCast()` walks each table in the table's order, not `CAST`'s, because the game has always let Ruthie ask before Cal. A row naming a state its character cannot hold throws on first scan, which is how the unreachable `ruthie === 'warm'` would have surfaced. *Daredevil, arc one Phase 3.*

**#278. Illegal relationship states are repaired on load and refused on write.** `repairState` resets an illegal state to the character's start state and drops unknown keys. Both writers, `applyEffects` and `triggerStatUpdate`, go through `setRel()`, which throws naming the character and state (#13); both used to be a bare `GS.rels[k] = v`. *Daredevil, arc one Phase 3.*

**#279. Tommy's track is three evenings, and Free Roam 1's ask is the gate.** Asking what he does at the FR1 bar sets `tommyAsked`, the only thing that unlocks FR2's car-show answer, the only writer of `tommy: 'ally'` before FR3. FR3's evening forks into `ally` or `absent`, so `TOMMY_PRESENT` on the FR4 card can actually close. *Daredevil, arc one Phase 4.*

**#280. The Tommy debt arm demotes flat, not conditionally.** "Borrow from Tommy" writes `tommy: 'hanger_on'` on `fr2_debt_tommy`'s stat update whatever he was before. A conditional write would have needed `statUpdate.rels` to become a function, a new engine form for one scene; FR3's evening is the way back. *Daredevil, arc one Phase 4.*

**#281. Danny's two new states come from one Free Roam 3 card, and Duke's answer picks.** `fr3_danny` is gated `_needs: { danny: DANNY_ON_CIRCUIT }`, so only a run that met him sees it. Somebody signed him (Earl, or a Fort Worth syndicate on the solo branch); calling him is `'poached'`, saying nothing is `'absent'`. FR3 day cards now go through `met()`. *Daredevil, arc one Phase 4.*

**#282. The ending roster is `rosterFor()` off the cast table, in the table's order.** The ending screen had built it from `Object.entries(GS.rels)` filtered on the literal `'unknown'`, but `unmet` is per character (Cal's is `null`) and `repairState` appends missing keys, so a pre-Phase-3 save printed Pete after Danny. *Daredevil, arc one Phase 4.*

**#283. A claim counts only once it is on `main`.** Write the branch into the `Claimed` column, open a PR carrying nothing else, merge it, then start; the cost is about two minutes of CI. Phase 4 was built twice on 2026-09-11 because each session claimed rank 1 on its own branch; PR #222 was closed unmerged. *Repo process.*

**#284. `_fr3_ruthie_route` is deleted, and the graph walker fails on the next unnamed route.** The route had been handled in goToScene() since round 1 but named by nothing since the Free Roam 3 Ruthie split moved onto `fr3_eve_ruthie`'s `_gateRoute`. Listed as handled-and-unreachable for three rounds with no failing check; `test/graph.mjs` now names any such route. *Daredevil, Phase 5.*

**#285. `m5_question_earl` is frozen as unreachable, not fixed.** The only road to Earl as `mentor` writes `cal: 'loyal'` twice, and Cal's route-table row sits above Earl's, so Cal always asks. Reordering the table is not a session's call (#277). The scene sits on `UNREACHABLE_BY_RELS` in `graph.mjs`, checked from both ends: a second entry fails and a stale one fails. *Daredevil, Phase 5.*

**#286. The hub economy is `js/money.js`, which imports nothing, and every hub budget is below its card count.** Importing `GS` would close `save.js -> money.js -> state.js -> save.js` and hit the temporal dead zone; every function takes state as an argument. The integer lives in `GS.flags.money`, coerced whole and non-negative on load. Budgets 3/4/3/4 (3 after a failed Milestone 4); the take is credited once per hub. *Daredevil, Phase 6.*

**#287. An evening's Condition cost is floored at 1.** An evening never takes the last point, because `DRIFT_A` is `52 + (1 - condition/5) * 150` and a hub that reached Condition 0 would hand the next stunt a drift nothing can ride. Stunts and crashes still go all the way down (`m5_stunt_loss` and `m1_stunt_crash` are −2). *Daredevil, Phase 6.*

**#288. The Bus Stack wants a $900 deposit on the solo branch only, and the price is on every card.** Spent at the choice, only when `rels.earl === 'absent'`. The three stunts' requirements are one exported table, `M4_STUNT_GATES`, read by the choices and Free Roam 3's hint. `costTag()` fills the evening tag ("1 Evening · $55 · Condition −1"); a card keeps its own `tag:` only to say why it is shut. *Daredevil, Phase 6.*

**#289. An accumulating number never goes on a `statUpdate`.** A scene reached by a choice fires its `statUpdate` twice; the first cut put the bank note's monthly there and transcripts read $182 instead of $145. `money`/`owePerMonth` go through `effects` only. The budget proof is split: every pip spent on any run; evening-costs-a-card proved on Free Roam 1-2 clean and 3-4 against a full cast. *Daredevil, Phase 6.*

**#290. Stunt difficulty derives from one number per scale in `js/stunt.js`, and the launch speed is solved from geometry.** `tierOf()` turns the jump count into gap (620/932/1,140 px), run-up, top end, landing zone, tolerance and drift. `speedForContact()` bisects for the speed landing 52.7% along the ramp (485/580/636), so a longer gap demands a faster approach by construction. The module imports nothing. *Daredevil, Phase 7.*

**#291. "Try Again" costs one point of Condition, once, and never on the Recovery; the Scale pill row is retired.** One retry at a Condition cost keeps the outcome earned; with no Condition the result stands. `canRetry(gameId, retriesUsed, condition)` in `stunt.js` is the whole rule. Out-of-order scales are ridden through `window.__dd`, not a player-facing pill row. *Daredevil, Phase 7.*

**#292. The Recovery's result is read.** `recordRecovery()` stores `recovery`/`recoveryRounds`/`recoveryReps` in the flag bag; `m1_stunt_crash_bad` and `m3_failure_bad_after` read it through `recovered()` and `recoveryCondition(base)`. Costs move a point each way (−1/−2/−3, −2/−3/−4). Before this, clearing four rounds or none cost the same. *Daredevil, Phase 7.*

**#293. Work the Crowd has a downside, and the autopilot reads the tier off the run.** SUCCESS gives Showmanship, PARTIAL nothing, FAIL takes the point back; `crowdWork` changes Earl's third line only. `tele` carries `greenC`, `targetTh`, `vmax`, `tier`, and `drive-daredevil.mjs` aims at them, so an unwinnable tier shows as a FAIL. With the old 485 the cars and buses failed. *Daredevil, Phase 7.*

**#294. `verify-touch-375.mjs` runs in CI, and the physical thumb pass is parked.** What it proves without hardware (pointer events, `.held`, a 300x87 target, computed `touch-action: none`, no overflow at 375px) runs on every commit. OS-level scroll suppression needs a person holding a phone, so it is a parked wishlist item. Parked is not verified. *Daredevil, Phase 8.*

**#295. The nine transcripts are an assertion, with the stunt score normalised to its verdict.** `transcript.mjs <run> --check` replays and diffs against the committed file, exiting non-zero. The stunt line's score and detail vary by frame rate (95 one day, 94 the next), so only SUCCESS/PARTIAL/FAIL is compared (#53); the scene path leads the report. *Daredevil, Phase 8.*

**#296. `daredevil-ci.yml` pins no browser, and installs with `npm ci --ignore-scripts`.** The suite compares scene ids, DOM text and save JSON, not pixels or V8 hashes, so it uses the harness lockfile's `puppeteer-core` plus `@sparticuz/chromium`; the lockfile is in the path filter. `--ignore-scripts` skips board-check's three.js postinstall, which 2D Daredevil does not need. *Daredevil, Phase 8.*

**#297. A skill cell the extractor has not been told about is an error, never a zero.** Cost and Attribute cells map to named shapes (`cp`, `included`, `see-description`; `spend`, `none`, `thread`, `uses`, `blank`, `unlisted`), non-numeric ones keep `raw`, anything else stops `tools/extract-skills.mjs` with file and line. Bare `Prowess` is a spend of one; `Thread Skill` in Verbal gives `verbal: null, thread: true`. *Numina, Phase 1.*

**#298. The extractor's count wins over the wishlist's, and the pin says so.** The hidden table has 22 rows, not the wishlist's 21, and `test/skills.test.mjs` pins 22. The currency table in `index.md` gets its own key rather than an ignore list, because a skip list lets a new table slip past. *Numina, Phase 1.*

**#299. The attribute chart's "Cost of next attribute" is modelled as `{ kind: "unpublished" }`.** The escalating numbers are in no converted chapter, so the data says so rather than guessing. Q32 stays open and was not pre-answered. *Numina, Phase 1.*

**#300. A skill's anchor is its name, and its row is found by text, never position.** `tools/skill-anchors.mjs` ids each row from the record id's name segment, falling back to group-name when not unique on the page (four `Holding`s). Rows match by heading id plus first-cell text; an unmatched record or two colliding anchors stops the build. The `§` permalink is CSS-drawn so Pagefind does not read it. *Numina, Phase 2.*

**#301. The autolinker links a term once per page, and an existing link to that target counts as the once.** `tools/autolink.mjs` links the first mention in `<main>`, never in headings, table headers, links, code or scripts, never to its own page. Marking used terms by href makes it idempotent. Glossary anchors slug the rendered heading, since raw-markdown slugs pointed 13 links at missing fragments. *Numina, Phase 2.*

**#302. One-word skill names and terms two records claim are not linked, and every exclusion must change the outcome.** 41 of 189 names are one word (`Attack`, `Shield`). `src/_data/autolink.json` holds 12 ambiguous terms, each with a required `why`. The suite rebuilds with the list empty and fails an entry already dropped by another rule; `Garb`, `Practice` and `Living` were removed that way. *Numina, Phase 2.*

**#303. A nation infobox carrying only its own "See also" row is not rendered.** `nation.njk` drops the infobox when a nation has neither capital nor demonym: three nations (Principalities of the Reach, Rues, T'barris), not the wishlist's eight, since five blank capitals sit beside a demonym. The source says those have no capital or shared name. *Numina, Phase 2.*

**#304. Q36 is answered yes: a character builder is welcome, and it prices nothing the book does not publish.** Every verdict carries `unofficial: true`. Excellency and Expression purchases ("unlocked in-game"), hidden ones (Staff approval) and a third Expression (email to Staff) come back in `verdict.provisional` beside the bill. Deleting the page leaves `skills.json` untouched. *Numina, Phase 3.*

**#305. A cost the rulebook does not publish is a field on the verdict, never a guess.** A raised Prowess adds to `cp.unpriced` with the chart's words and sets `cp.exact` false; `cp.spent` is then a floor, and a build over 50 only on unpriced buys is not over budget. "See Description" skills price as `cp: null`. Purpose is priced at 4 CP. Q32 stays open. *Numina, Phase 3.*

**#306. An Excellency is a name the player types.** The Excellencies chapter is a 34-word stub (Q33), so `offered()` returns `choices: null` for step 5, not an empty array. Priced by tier (5, 6, 7), the name is matched lowercased against the 18 hidden Excellencies; "Deadeye" flags Staff approval. *Numina, Phase 3.*

**#307. The Aspect and Foundation lists are extracted data, fenced by the headings that bracket them.** Nine Aspects and twenty Foundations are `###` headings, read between two fence headings, not by pattern; a renamed fence throws. A Foundation's Type names the table its skills come from, and an unknown Type or missing table throws. Aspect and Foundation ids are keyed separately (`arcane` is both). *Numina, Phase 3.*

**#308. Included skills are granted, not purchased, and spend no allowance.** Thirty "Included" skills (each Domain's Determination, Resource/Contacts, each Expression's first row) land in `verdict.granted` at zero and do not count against "up to 2 Culture skills". The nine Adventurer skills are granted to every build. Air's Determination says `0`, not `Included`; both price at zero. *Numina, Phase 3.*

**#309. A third Expression lowers the Excellency cap to two.** `expressions.md` trades the 3rd Excellency slot for a third Expression. Three Expressions in a build is the trade itself, not a flag, so three Excellencies beside three Expressions is illegal with a message naming which slot paid. One state, not two that can disagree. *Numina, Phase 3.*

**#310. The builder's form is the state, and a step re-renders only when what it offers changes.** Controls are named for the build fields they write; the build is read from the form on each input. `stepSignature()` hashes a step's choices, skills and driver, so typing a name does not rebuild the field under the cursor and drop focus. *Numina, Phase 3 increment 2.*

**#311. A pasted fragment wins over the saved build, the fragment is rewritten in place, and an empty build clears both.** Key `numina.build`, record `{ v: 1, build }`; unversioned reads as version 0 through `repair()`, which keeps unknown skill ids for `priceBuild()` to name. The fragment is short keys in step order via `history.replaceState`, only non-empty fields. "Start over" removes key and fragment. *Numina, Phase 3 increment 2.*

**#312. Tongue of Aspect is one checkbox per chosen Aspect.** It is the one skill a build may hold twice, and a single box cannot say which Aspect it serves. No Aspect chosen gives one disabled box saying so; two Aspects give two labelled boxes, and the build holds the id once per ticked box. *Numina, Phase 3 increment 2.*

**#313. `skills.json` and the anchor map are inlined in the builder page, not fetched.** Two `<script type="application/json">` islands written by `jsonIsland` and `skillLinks`, URLs from `skillAnchors()` with the path prefix already applied. The page is 139 KB: no fetch, race or drifting copy. `tools/json-island.mjs` escapes `</`, and the suite plants a `</script>` to prove it. *Numina, Phase 3 increment 2.*

**#314. The printable card is `renderCard()` in `build-view.js`, and `print.css` hides everything else on `main.builder-page`.** A fifth module would carry nothing new. Print scoping keys on a class only this page has, so the site keeps one stylesheet. Attribute purchases go on the CP line, not the skill table. Classes are `sheet__*` since `.card` is the site's link tile. One Letter page at 7.5pt. *Numina, Phase 3 increment 3.*

**#315. Excellency and Expression purchases are skill-table rows flagged from the verdict; the card shows on screen and prints the share URL as text.** Their Verbal cell reads "Unlocked in-game" or a hidden-item Staff approval note. The card renders under the verdict so players and Staff see it without printing. The URL is text because `print.css` appends `(href)` to links. Foundation prints as "Military (Place)". *Numina, Phase 3 increment 3.*

**#316. `--header-h` is 5.0625rem, because 5rem understated the header.** Measured in Chromium at 1280, 700 and 420px the header is 80.97px (0.65rem + 1.75rem wordmark at line-height 1.65 + 0.65rem + 13px ornament + 1px border), so stuck timeline chips sat 0.97px under it. `test/a11y/layout.mjs` fails if the declared value is not within 2px above the measured header. *Numina, Phase 4.*

**#317. Contrast is checked on a flattened page, and without a browser by token arithmetic.** axe returns "incomplete" on this site's noise-textured, pseudo-element chrome (642 of 710 text nodes on Core Rules), so a green run meant nothing. `axe.mjs` runs a second contrast pass with `background-image` off and ornaments neutralised; `test/smoke.mjs` computes the `--gold-text` ratio (fails under 4.5) and fails any non-`.orn` selector using `--gold` as text. *Numina, Phase 4.*

**#318. The Excellencies chapter was unconverted, not withheld, and is now ported.** Pages 60 to 75 of `rules-2026-v3.51.pdf`: 30 Excellencies, 239 skills, read with `pdfplumber`'s table finder, taking `skills.json` from 189 skills to 428. Reversible: re-running the extractor without the one markdown file restores 189. The hidden Excellencies table was not touched. *Numina, Phase 5/6.*

**#319. `site.official.website` stays `http://` until someone can load the host over `https://`.** This environment's egress refuses the host, which is no evidence either way. An `http://` link to a redirecting host still works; an `https://` link to a host that does not serve it fails. The reason lives in a `websiteSchemeNote` key in `site.json`. *Numina, Phase 5/6.*

**#320. The book's Historical Timeline is fully ported; extending it means inventing a date.** All 17 rows were already in `timeline.json` and the campaign book has no AW or AF date outside that table. Work became enrichment (hrefs, `nations`, splitting the 124 row into two events, 17 to 18). CONTENT-GUIDE forbids inventing facts at the schema. *Numina, Phase 5/6.*

**#321. The print packet is assembled in the browser from published HTML; the Combat Card is a link.** `src/js/packet.js` fetches chapters listed from `nav.json`, demotes headings, namespaces ids and rewrites in-packet links to fragments. A build-time render would be combinatorial and a second copy to drift. Without JavaScript the page is still links to its 49 chapters. *Numina, Phase 7.*

**#322. The service worker's version is a content hash excluding `pagefind/`, and it precaches only Pagefind's fixed-name files.** Pagefind's index chunk names are not stable across machines, so hashing them would demand a rebuild on every PR. Index chunks land in cache when first searched. `smoke.mjs` fails if `pagefind/` contributes to the version or if committed `sw.js` differs from the generator's output. *Numina, Phase 7.*

**#323. Packet page numbers are a named `@page packet` margin box, and the contents carries no page numbers.** Measured by PDF differentials in pinned Chromium: `counter(page)` in `@bottom-center` works (1,936 bytes larger), `target-counter()` is unimplemented in Blink (zero bytes). Named so the six single-print chapters, above all the Combat Quick Reference card, are untouched. *Numina, Phase 7.*

**#324. An offline check has to shut the origin down, not emulate it away.** Two guard-rails passed while broken: Chromium's HTTP cache answered via heuristic freshness, and `context.setOffline` does not cover a service worker's own fetches. The harness now serves `no-store` everywhere and `packet.mjs` closes the server and destroys sockets before navigating; `setOffline` stays only for `navigator.onLine`. *Numina, Phase 7.*

**#325. "Universal" on an Excellency means every Domain.** Arcaneer and Tinkerer are Universal, and the chapter says alignment is informational. Linking nothing or treating Universal as a seventh Domain with no page would both be wrong, so it expands to the six Domains in the "See also" blocks. *Numina, Phase 8.*

**#326. A "See also" block is a `<div>` with a heading, not an `<aside>`.** `<aside>` is a complementary landmark needing a unique name; six "See also" landmarks on the Domains chapter fail `unique-landmark`, and names like "See also: Air" would be labels invented for a checker. The heading names the block for heading navigation. *Numina, Phase 8.*

**#327. The HTML validity check is for validity, not code style, and id slugs are a published interface.** 3,096 of 3,709 first-run messages were Nunjucks trailing whitespace and 312 were doctype case or boolean attribute style; those rules are off. `valid-id` is `relaxed` because `markdown-it-anchor`'s `encodeURIComponent` slugs (223 of them) are fragments players cite. *Numina, Phase 8.*

**#328. `wcag/h32` is off; its one real finding is fixed and guarded in `smoke.mjs`.** Three of four forms (builder, packet picker, all-skills filter) never submit, and `builder.js` needs `form.elements`. The header search form, the only one with an `action`, lacked a submit button on all 58 pages; it has one now and `smoke.mjs` holds it. *Numina, Phase 8.*

**#329. `nav.json` stays, and its guard now runs both ways.** Four things in it exist in no frontmatter: position of three order-less entries, two-level nesting under Skills, the deliberate "Skills" nav title, and the `nations: true` splice. It has three readers including `/mechanics/packet/`. The guard now also fails an entry pointing at a page that was not built. *Numina, Phase 8.*

**#330. The `--pf-*` Pagefind theming block is on `:root:root`.** The vendor sheet sets defaults on bare `:root` and loads after `main.css`, so the override did nothing; `--pf-text-muted` stayed `#767676`, which axe flagged at 3.65:1. Doubling the selector (0,2,0) wins wherever the sheet lands. *Numina, Phase 8.*

**#331. The blend station's Add Ice button is removed, not wired.** It set `cup._blendIce`, which nothing read; a blended drink's ticket has no ice line, its requirement is `cup.blended`. The milk station's ice toggle is the one that counts, and the hint no longer says "then blend with ice". *Corner & Kettle, Phase 1.*

**#332. Time is fixed-step, and a closed shop drops its bank.** `advance()` pays out in `STEP_MS` (1000/60) steps with a 1e-6 ms slack for float residue (8,160 frames summed to 136000.0000000124). A shift not running takes no steps and zeroes the bank, so an open day-end modal does not replay minutes. The old per-frame delta made behaviour depend on frame rate. *Corner & Kettle, Phase 1.*

**#333. The sim speaks through `notify()`, and the page coalesces.** Three event types: `toast`, `render` with `queue` or `all` scope, and `shiftEnd` with the summary. Renders batch to one per frame inside the loop and happen at once from a click or debug hook. In Node nobody listens. *Corner & Kettle, Phase 1.*

**#334. The served cup's half second is on the sim clock.** `scoreServe()` marks the slot `serving` with `servedAt` and `advance()` clears it after `SERVE_CLEAR_MS`. The old `setTimeout(..., 500)` was a fourth clock the harness could not warp. *Corner & Kettle, Phase 1.*

**#335. An order carries its sprite's colours, not its markup.** `generateOrder()` picks `{hair, skin, shirt, pants}` off the injected rng and `makeSpriteSvg(sprite)` in the page draws them, replacing about 700 bytes of SVG per order. Drawing is the page's job; an order is data. *Corner & Kettle, Phase 1.*

**#336. The balance band reads two batches, and patience is banded on the hardest day only.** `BAND.run` is the patient player over 100 seeds x 30 days, reopening at day 10 (served share, net/day, accuracy). `BAND.stress` is day 30 at prestige 5 over 50 seeds (served share, patience at serve). A halved patience floor was invisible on ordinary days, so a rail there could not fail. *Corner & Kettle, Phase 2.*

**#337. `HAND_MS` is 800 ms with one pair of hands, and it is an assumption.** Station bars run 350 to 1100 ms; 800 per ticket line is a person neither asleep nor scripted. Numbers compare players on the same hands. A session that measures real cadence should change the constant, not the band. *Corner & Kettle, Phase 2.*

**#338. "Walked" is reported as "in line at close", because nobody walks.** Patience only ticks in the queue and only stops the tip; the queue cap of five refuses spawns. The harness names what exists rather than inventing a walkout; a phase adding walkouts changes the sim and shows in this column. *Corner & Kettle, Phase 2.*

**#339. `autopilot.mjs`'s `purchase()` mirrors `doUnlock()` until Phase 4.** The chalkboard was still page code, so the shopper carried the same arithmetic with barista ids `b<n>`. A purchase rule changing before Phase 4 had to change in both places. Closed by #344, which deleted the mirror. *Corner & Kettle, Phase 2.*

**#340. Round 3's balance table is retired as the comparison.** Its dollars ($309, $452 a day) cannot be a day's takings when 41 cups at $30 is $1,230 before tips. `balance.mjs` prints it beside the harness numbers and says why; the harness is the baseline, and a balance claim without a seed and run count is not one. *Corner & Kettle, Phase 2.*

**#341. The Serve gate is the cue, not the hard gate.** Q2, answered by the session. `scoreServe()` prices partial credit on purpose (`price * (0.35 + 0.65 * ratio)`); a short cup's button reads "Serve 3/5" in amber with the missing lines in its `aria-label`. Reversible in one line: `serveReadiness()`'s `canServe` becomes `missing.length === 0`. *Corner & Kettle, Phase 3.*

**#342. One requirement list, with a station and an `apply` per line; an empty plate is not an attempt.** The station dot, Serve button, barista and scorer all read `getOrderRequirements()`. A food order's `canServe` is "something is plated", ending the 40% empty-plate serve. The ice line lives at the Milk station. Moving the food gate took eager net from $1,281 to $1,457. *Corner & Kettle, Phase 3.*

**#343. Blending makes the base the blended base; a shot into a blended cup keeps it.** Before, a hand-built Frappe could never be complete: Blend kept an existing `'espresso'` base and a later shot reset it, so only a barista could finish one. Both build orders now work; no other recipe blends. *Corner & Kettle, Phase 3.*

**#344. The chalkboard is one purchase table in the sim.** `doUnlock()` became `PURCHASES` rows (`cost`, `refuse`, `apply`) read only by `canBuy()` and `purchase()`, so the `disabled` attribute and the charge share one rule, and a refusal toasts its reason (the old code said "Unlocked!" on refusals). Hire ids are `b1`, `b2`, `b3`. *Corner & Kettle, Phase 4.*

**#345. The station buttons are one action table in the sim.** `CUP_ACTIONS` with `ms` and `run`, through `cupAction()` and `cupActionMs()`. `smoke-sim.mjs` section 10 fails if a view module writes `state.money`, a cup field, a plate, an unlock set, an upgrade, `level` or `trained`, or calls `doUnlock()`. *Corner & Kettle, Phase 4.*

**#346. The save is a 4 s dirty timer with immediate saves, not `autosave()`.** `autosave()`'s `pagehide` flush wrote the departing shop over storage wiped from outside, failing six `drive-save.mjs` checks (93/6). Serves, purchases, shift ends and starts, presets, mute, imports and New Game write at once; 13 writes fell to 3 in a 15 s test. Reversible when `gvb-save.js` gains a no-flush option. *Corner & Kettle, Phase 4.*

**#347. The board was edited, not asked.** Phase 4's "ask, do not edit, for the board" predated retirement of the shared-file request queue. `index.html`'s card, `landing.html`'s row and `Tools/board-check/games.mjs`'s `url` point at `Projects/corner-and-kettle/` in the same PR, and the new page carries the generated social block. *Corner & Kettle, Phase 4.*

**#348. Staff have skills, morale and a training day, and wages count only who worked.** `skill: {bar, kitchen, register}` replaces `trained` and `spec`; `effectiveSpec()` derives specialism. Training costs a shift at 1.6x slower and 1.3x clumsier. Morale starts at 70, drops 6 per worked day, rises 10 off or 25 on a raise. `sim.wagesDue()` fixes wages charged for days off. *Corner & Kettle, Phase 5.*

**#349. A regular is a person with memory, and word of mouth is clamped.** `state.regulars[name]` is `{order, visits, lastDay, satisfaction, tolerance, stopped}`; three bad serves at or below 20 stop them, good serves at 85+ roll 25% for a new regular. `wordOfMouthSpawnMult()` and `wordOfMouthRegularMult()` clamp to 0.7 to 1.4. `prestige()` keeps regulars but resets satisfaction. *Corner & Kettle, Phase 6.*

**#350. `Pathfinder/data/` is a published interface.** Any project may fetch it same-origin at runtime or vendor a slice under #17, but may not write to it, must assert every field it relies on in its own suite, and must add `Pathfinder/data/**` to its workflow paths. The Anathema Archive owns it and searches for readers before reshaping. Contract: `Pathfinder/data/README.md`. *Site CI.*

**#351. Site CI runs on every pull request, with no path filter.** `.github/workflows/site-ci.yml` runs board-check plus a matrix of twelve previously unrun suites, because the breaks it targets are cross-project. `.github/workflows/suite.yml` is the reusable template (Absalom, Torchbearer, The Fourth Quarter, Corner & Kettle use it); Hearth, Numina, School Generator and Daredevil keep their own browser setups. *Site CI.*

**#352. board-check in CI is graded against `Tools/board-check/known-failures.json`.** `main` had one integrity and six social failures. `ci-check.mjs` runs all three checks and exits 1 on an unlisted failure, on a listed failure that no longer appears (the list can only shrink), or on a non-zero exit with no FAIL line. It runs collisions even when integrity is red. *Site CI.*

**#353. Playwright-only browser suites stay out of CI; the Anathema suite retries only re-rendered-element clicks.** On Linux `harness.mjs` launches Puppeteer, so three suites failed there (two archived tools, Integer Foundry). Anathema's click helper retries "detached from document" and "not clickable" errors, both thrown before the mouse goes down: old helper 1 of 10 runs passed, fixed 15 of 15. *Site CI.*

**#354. Prompt Builder's fonts are vendored, and Fraunces is the variable cut.** Six woff2 (165.1 KB) into `Tools/prompt-builder/fonts/`, the last integrity failure. Fraunces is opsz + wght (67.3 KB against 18.1 KB static) because `header h1` uses `font-optical-sizing: auto` from 1.12rem to 3.2rem. Two files duplicate `assets/fonts/`, which is #17 working. *Five-row batch.*

**#355. Every `.html` in the repo has a named owner, enforced by `Tools/board-check/ownership.json`.** `check-integrity.mjs` fails any page no area claims. New areas: Prompt Builder and Archived teaching tools. Its first run found `Projects/The-Fourth-Quarter.html` unowned, and it went to The Fourth Quarter. *Five-row batch.*

**#356. A local `url()` has to point at a file that exists.** The offsite sweep passed a typo'd `inter-latin-999-normal.woff2` clean. Every local `url()` in every `.html`/`.css` is now resolved, with three stated skips (two `url(%23n)` inside `data:` URIs, one runtime template literal in `landing.html`). Units checked: 1,590 to 1,813. *Five-row batch.*

**#357. An offsite board notice is skipped, and a page bringing its own social tags is exempt but verified.** `path.join` turned the aspermylessonplan.com link into a missing local file; offsite notices are now skipped narrowly. Numina is exempt because Eleventy regenerates `Numina/index.html`, but must still carry `og:title`, `og:description`, `og:image` and an icon. *Five-row batch.*

**#358. The generated social block wins over a hand-written favicon.** Blue Hour and School Generator now take the generated block and the site seal, one mark everywhere; School Generator's PWA icon stays in `manifest.webmanifest`. Bell to Bell and Hearth gained blocks falling back to `guild-board.png`. Reversible per page via `OWN_TAGS`. *Five-row batch.*

**#359. A Closing Time deal mid-contract on deleted content is survivable, not supported.** Unguarded reads in `deals.js`, `calendar.js:95` and `clients.js:9` threw on day advance. `repairCareer()` drops deals, clients, listings and offers whose referenced records are gone, resets orphaned `underContract` only when no deal points at it, and writes a Ledger line per drop. *Five-row batch.*

**#360. A Corner and Kettle reopening is a trade: beans, a Legacy tree, shop layouts and a ledger.** Beans (`state.meta.beans`) pay one per two days survived and one per twenty reputation; `META_UPGRADES` spends them and `SHOP_LAYOUTS` picks the starting shop. `sim.reopenPreview()` feeds `#reopenOverlay` with kept, earned and lost lists, replacing a `window.confirm` that named nothing. `prestige()` with no argument is still the old reopening. *Corner and Kettle, Phase 7.*

**#361. A run's menu is derived, never stored.** Only money-bought recipes are written to `state.unlockedRecipes`; `recipeAvailable(id)` reads prestige-level and bean-unlock grants live every time. Writing the grants in would have needed `purchase`, `prestige` and `repairSave` each to remember, three copies of one rule, which is the #344 affordability bug one layer down. *Corner and Kettle, Phase 7.*

**#362. Beans are a second currency inside the one purchase table.** Legacy rows carry `currency: 'beans'`; `canBuy()` reports it and `purchase()` reads it to pick the pot. One table still holds every chalkboard button (#344), and the discount never touches a bean price, since a tree that discounted itself would pay for itself. *Corner and Kettle, Phase 7.*

**#363. Every price the chalkboard prints is `canBuy().cost`.** Rows printed `$${u.cost}` straight off the tables, which broke once a Legacy unlock could take 20% off. `dis()` gained a sibling `price()` and eleven rows read both from one call. Verified by making `need()` use the undiscounted price: a till with exactly $280 was refused. *Corner and Kettle, Phase 7.*

**#364. The loop band is 60 days and one reopening, and the engine is the spawn floor.** `loopSweep()` plays twelve seeds three ways and `BAND.loop` holds both edges at 1.0 (measured 1.069 and 1.066). Two reopenings inside 30 days come to 0.85. Pinning `spawnFactor()`'s prestige floor at 0.6 drops it to 0.984, while removing the income bonus leaves 1.051. *Corner and Kettle, Phase 7.*

**#365. Five recipes that duplicate another recipe's requirement list stay that way, named in the assertion.** Cappuccino, Cold Brew, Nitro Cold Brew, Affogato and Doppio each match another recipe's list. Reshaping shipped recipes is a balance change needing a sweep, so the list is the check, and a second line holds the four prestige-gated recipes to the distinctness rule. *Corner and Kettle, Phase 7.*

**#366. A layout's queue bonus is a trade, not an upgrade.** The Kiosk's +2 queue cap, measured at level 5 on day 30, leaves 8.2 in line against 6.1 and serves 64.6 against 65.3, because patience drains in the line and one pair of hands cannot work it. It stays, described as a risk upgrade like `sign`. *Corner and Kettle, Phase 7.*

**#367. The key map is read off the panel that was just rendered.** `bindKeys()` walks `#stationsAll .actionbtn` in DOM order and hands out letters; `renderKeyLegend()` prints the array it returns on the same pass. No second list exists, so the legend cannot go stale. Bindings can move when a button arrives, but never silently. *Corner and Kettle, Phase 8.*

**#368. Ten letters, `q` through `p`, and an overflowing tab leaves controls unbound.** Digits, `S`, `[` and `]` are taken; the widest tab needs seven. A tab past ten leaves extras keyless rather than reusing a key, and section 12b fails when that happens. `data-nokey` opts a control out; the six preset deleters carry it. *Corner and Kettle, Phase 8.*

**#369. A disabled control keeps its key, and `pressKey` clicks the button without re-checking `disabled`.** Skipping disabled buttons shifts keys under a moving hand (Steam Milk reported `key null`). `pressKey` calls `.click()`, which dispatches nothing on a disabled button, so the separate `disabled` check was unreachable and was deleted (#147). *Corner and Kettle, Phase 8.*

**#370. `[` and `]` wrap across the two to four stations.** The last station is one press from the first rather than a dead key. Clamping instead was the break that proved the assertion. *Corner and Kettle, Phase 8.*

**#371. Phase 9 shipped as a commit, not a written shared-file request.** The wishlist said to write the `play-games.mjs` section into the notes' Shared-file requests, but the root `CLAUDE.md` retired that queue. The section went straight into `play-games.mjs`, tested; its registry entry had been in `games.mjs` since Phase 4, unread. *Corner and Kettle, Phase 9.*

**#372. The shared suite finishes an arbitrary ticket with the game's own barista step and keeps only the Serve click real.** `GAMES['corner-and-kettle'].open()` can draw a food order, so hand-building the cup would copy the ticket rules. It drives `autoAssistStep()` then clicks Serve. Beats: a shift runs, `dayStats` moves, the clock advances, reload resumes the same day and till. *Corner and Kettle, Phase 9.*

**#373. Nine `npm run games` failures pre-date the Phase 8/9 batch and belong to three other games.** 210 checks, 9 failures: seven in Golden Hour, one aborted Integer Foundry run ("Node is detached from document"), and The Fourth Quarter's room-fill plus missing `.ogg` files. All reproduce on `main`; Golden Hour's are #53's inconclusive class, and `npm run games` is outside CI (#353). *Site, games suite.*

**#374. The Castle Conundrum gate door was a Poly Haven preview ball; the leaf is built now.** `wooden_gate_1k` is a texture pack whose only mesh is `Sphere.001`, auto-scaled to 3.6 m. `buildGateLeaf()` extrudes a 0.16 m round-headed leaf sized to the archway opening measured from `wall-fortified-gate.glb` (2.0 m wide, apex 3.0 m), inset 0.05 m. The auto-scale branch was removed. *Four-quarter batch.*

**#375. The gate opens to 90 degrees, not 105.** A 1.9 m leaf hinged 0.95 m off centre at 105 ends 0.44 m inside the west jamb and reads as a dark sliver; at 90 it lies flat against the jamb with 0.03 m in the stone, within its relief. Both poses were rendered before changing. *Four-quarter batch.*

**#376. `Projects/Castle Conundrum/test/assets.mjs` is the project's first CI job.** Browser-free glTF parsing: fails on a missing model reference, a preview ball (`sphere_gltf` node name AND near-cubic bounds centred on origin), leaf dimensions not matching the opening, or a swing the opening cannot take. The playable half stays hand-run. *Four-quarter batch.*

**#377. A cancelled request is not a failure.** Beats reload three times and cancel in-flight lazy font fetches (`net::ERR_ABORTED`), failing 2 of 6 runs. `harness.mjs` now records the reason and drops cancellations. `requestfailed` never sees an HTTP 404 anyway; missing `url()` targets are `check-integrity.mjs`'s job, and blocked offsite requests still report as `net::ERR_FAILED`. *Four-quarter batch.*

**#378. The Pathfinder `[shared]` chrome is asserted, not diffed by hand.** `Pathfinder/tests/shared-chrome.test.mjs` compares the eight blocks in `characters.html` and `campaigns.html`, slicing each by first and last selector, counting markers, allowing only `.tome`'s max-width and campaigns' three colour tokens. `[shared pattern]` is deliberately not compared. Pass messages name what they allowed (#147). *Four-quarter batch.*

**#379. Castle Conundrum's preview row is parked, not verified.** An unattended session cannot review it: `candidates/` holds only `chosen.json`, a recapture fails under software rendering (#53), and the shipped previews show the gate open, captured before #374. It moved to a Parked section; eight hardware-needing rows stayed ranked, since moving them nears a wholesale re-rank. *Four-quarter batch.*

**#380. The Model column is assigned in `BACKLOG.md` when the item's source names none.** A row whose source names a model keeps it. Otherwise: Sonnet 5 where the work is bounded and an oracle exists, Opus 5 as the default for judgement with a suite underneath, Fable 5.1 where a wrong answer is silent. Split was 15 Opus, 15 Fable, 10 Sonnet. *Backlog process.*

**#381. Three ranked rows had already shipped and were deleted.** PR #284 closed old ranks 20, 23 and 24 but left them in the table. Deleting shipped rows is not re-ranking: relative order is untouched, rows below shift up, and the header's lists and cross-references were renumbered with them. *Backlog process.*

**#382. A batch is sized by the Size column and by how many areas it spans.** One area: 6 quarters, 3 halves, or one 1 plus two quarters. Spanning areas: 4 quarters, 2 halves, or one 1. A 2+ row is the whole batch. Old caps sat about a third below capacity; what scales is the closeout per area. The session prompt now lives in `BACKLOG.md`. *Backlog process.*

**#383. A camera's heading comes off its world matrix, not off `camera.rotation`.** Controllers write `camera.quaternion` from a YXZ Euler, and `rotation` decomposes in XYZ, so at yaw ±π `drive.mjs`'s `camState` read `facing` and `pitch` 180° wrong and `walkTo` oscillated. The fix negates `matrixWorld`'s third column. `lookAt` also takes the short way round, with `facing` wrapped to (−π, π]. *Board-check harness.*

**#384. Aphelion has an airlock-entry beat, and the `#signal` assertion lives in it.** Eleven checks in `play-games.mjs`: readout silent inside the hab (asserted first), the walk aft, `E` cycles to EVA, `SALVAGE 13m · 25m · 38m` nearest-first, readout quiet again inside. `arrived` keys off the game's interact prompt, not a timeout (#53). A no-bearing regex failed on the S and E in SALVAGE and was deleted (#147). *Aphelion.*

**#385. Buyers carry a per-client financing type: `cash`, `conventional`, `fha` or `va`.** In `js/engine/financing.js`, it moves the accept floor, earliest close, which milestones exist, fall-through odds and rate sensitivity, and whether the appraiser reviews condition. Measured on `ls_0001` at $168,000 ask: cash to $144,750, conventional $150,000, FHA $155,000. The type belongs to the client, not the offer form. *Closing Time.*

**#386. A save field that `repair` recomputes must not touch `rand()`.** `repairCareer` backfills `rec.financing`, and `repair` runs on every load (#37), so a `rand()` there would advance `S.seed` per reload and fork the career. `financingFor()` is a djb2 hash of the client id instead; the suite asserts `fixed.seed === seedBefore` across a repair. *Closing Time.*

**#387. Integer Foundry's own suite had an off-by-one, fixed inside an unrelated PR rather than re-run.** `test/browser.mjs` placed the sink at column 8 of a 0 to 7 grid for orders of exactly 8, and CI aborted at 38 checks. A re-run would have passed and left the bug waiting. The fix reads operators and sink off one hard-coded path on the 8×6 floor. *Integer Foundry.*

**#388. A helper a browser suite uses to work out placement belongs in a module the Node suite can check across its whole input range.** The line geometry moved to `test/order-line.mjs`; `browser.mjs` imports `planOrderLine()`, and `smoke-targets.mjs` checks every order size, read out of `rollTarget(state, rand)` rather than hard-coded. `planOrderLine()` returns null rather than throwing, so a misfit is a named miss. *Integer Foundry.*

**#389 to #394 and #411 to #490: Castle Conundrum's.** They moved verbatim
with the project on 2026-09-15 to `HISTORY.md` in
[`GreyVersusBlue/castle-conundrum`](https://github.com/GreyVersusBlue/castle-conundrum)
(#491): the asset diet, the quest graph, the v2 plan, Devon's answers to Q53
and Q58, and all seven v2 phases. This is a pointer, not a copy. #396 to #410
did not move; they belong to Orbital, Closing Time, Numina and the School
Generator.

**#396. Orbital's editor draft lives in the address bar, with no new save key.** `#e=<code>` is a draft and `#l=<code>` is a level to play, written by `history.replaceState` after each edit. The only storage stays `orbital_progress_v2` (#36), so an editor bug cannot cost a campaign. A `hashchange` means a pasted link and is wired. *Orbital.*

**#397. A level is one line of text, with frozen letters and `$ ; , @` delimiters.** `js/levelcode.js` encodes `o1$name$sub$start$goal$bodies`, one letter per body type (`p s k u b w t`). All four delimiters are legal raw in a URL fragment and all are escaped by `encodeURIComponent`; `|` was refused. Add a type by a new letter, a field by appending; take `o2` only if forced. *Orbital.*

**#398. The level decoder is strict and the validator is separate.** `decode` errors with a reason on unknown letters, bad counts, names over 48 chars, over 24 bodies or codes over 2,000 chars; `encode` refuses what `decode` could not read back. `validate` checks semantics: the editor shows its problems, a share link refuses. A shared level has no `key`, so it records no stars. *Orbital.*

**#399. The editor's solvability verdict and CI's are one implementation at one budget.** `makeSearch`/`findWinningShot` moved into `physics.js`; Check runs the suite's 240 x 20 grid with 60 refinement rounds. It runs in 12 ms `setTimeout` slices because headless software Chromium fires `requestAnimationFrame` 5 times a second against `setTimeout`'s 244. `test/physics.mjs` re-flies the reported shot. *Orbital.*

**#400. The level round-trip sweep aims at each body, because a 12-vector sweep missed a dropped booster kick.** `test/levelcode.mjs` asserts round trips by flying them. Twelve spread vectors flew near no booster, so re-encoding `boost` as `dir` passed. Aimed shots at two powers now catch it on two of three booster levels; Gravity Assist is caught only by the validator, and the comment says so. *Orbital.*

**#401. The Orbital generator proposes and the existing judges decide.** `js/generator.js` builds a candidate from tier and seed; `OrbitalCode.validate` and a 1,200-launch census (120 angles by 10 powers, a subsample of the CI grid) accept or reject, up to 40 candidates. `physics.js` exports `SEARCH` so a census win is a `findWinningShot` win by construction. *Orbital.*

**#402. The census win fraction is a tolerance measure, not difficulty, and tiers are recipes.** Shipped levels run 0.75% to 12.7% with no relation to pack position. Easy, Medium and Hard set body counts (1 to 2, 2 to 4, 3 to 5) and allowed types, and hold the census to bands of 1 to 8%, 0.8 to 5% and 0.5 to 3%, a first reading against 18 seeds. *Orbital.*

**#403. A level is decoration when its wins would win with every body removed.** The census re-flies each win with no bodies; the judge refuses a candidate where more than a third of wins survive that. First Light scores 18 of 18, The Long Way 9 of 9. A "passes within 3.5 radii" rule was tried first and was wrong both ways. *Orbital.*

**#404. A rolled sector is a shared sector.** No `key`, no stars, no unlock; the URL carries it under `#l=` immediately, so reload replays it and the URL is the share link. The seed is in the name (`Sector 3DF5ST`, base 36) but the link carries the level itself. No second save key (#36, #396); rolls are sliced as in #399. *Orbital.*

**#405. The generator judge's verdicts are pinned to the 22 shipped levels.** `test/generator.mjs` asserts 16 accepted, First Light `decoration`, The Long Way `needle`, and four `loose`, so a band change names the level that flipped. Generated levels (3 tiers by 6 seeds) must be deterministic, valid, round-trip, pass their own judge and re-fly to a WIN. A spent cap returns null with a histogram. *Orbital.*

**#406. An escalation clause resolves against the highest submitted price, never another clause's escalated result.** Escalating against results is mutual recursion ending at both caps. `resolveField()` in `js/engine/escalation.js` is pure and the only place a clause becomes a price: a clause pays at most one increment over the runner-up's paper, and a straight number above a cap wins. *Closing Time.*

**#407. A clause is `{cap, increment}`.** The old bare `escalation: 155000` only raised a counter ceiling and could not resolve against anything. `clauseOf()` reads the old number at a $1,000 default increment and `repairCareer()` rewrites it on load. A cap at or below the offer's own price reads as null. *Closing Time.*

**#408. Highest and best is one call per listing and can empty the room.** It holds the field two days; each agent raises, stands pat or walks per `HB_STYLE`, walk odds scaled by heat. Over 400 seeded fields the top number moves a median +2.38%; a two-offer field empties 2.5% of the time, a five-offer field never. *Closing Time.*

**#409. The escalation clause pays before the field it beats is cleared.** `acceptSellerOffer()` resolves first, writes `escalatedFrom`, then marks others rejected; resolving after would pay paper price. Because `respondToOffer()` had already set the winner `accepted`, `openOffers(pl)` excluded it, so the winner is added back to the field by hand. *Closing Time.*

**#410. A buyer's clause costs the buyer the information it buys.** The player can write one; `fireBuyerClause()` calls `escalateAgainst()`. It is worth 0.015 strength in `agentRespond()`, and the listing agent then counters at the cap. On `ls_0001`, an 86%-of-ask offer draws $163,500 bare and $166,500 with a cap. *Closing Time.*

**#491. Castle Conundrum left for its own repository, and this repo keeps only its board card and images.** `Projects/Castle Conundrum/`, `play-castle.mjs`, the `play` script, its `games.mjs`/`capture-previews.mjs` recipes and CI entry were deleted after `git subtree split`. `gvb-save.js` has thirteen adopters here. Hosting, DNS and redirects are Devon's. `sync-social-tags.mjs` briefly gained an `ELSEWHERE` list (removed by #493). *Castle move.*

**#492. A decision number resolves in its own repo's `HISTORY.md`.** From #491 the two repos number independently, so this repo's #495 and Castle Conundrum's #495 are different decisions. Nothing here cites the moved band (#389 to #394, #411 to #490); if something does, it means the other file. *Castle move.*

**#493. The Castle Conundrum board card is an offsite notice, and `ELSEWHERE` is deleted.** The card links `https://greyversusblue.github.io/castle-conundrum/` in `index.html` and `landing.html`, so the existing offsite branch in `sync-social-tags.mjs` catches it. An empty mechanism was deleted rather than kept. Restoring the relative href fails `social:check` with exit 1. *Castle move.*

**#494. gvb-save.js v2 changes no key and no byte a v1 slot writes.** `createSaveSlot` keeps its surface: `save()` returns a boolean, `load()` never throws. New things hang off the side (`slot.usage()`, `slot.lastError`, `slot.tier`, a third `autosave()` argument, three constructors). The save bar's import now reports a failed write through `failureMessage(slot)` instead of claiming "Save loaded." *gvb-save, v2.*

**#495. Quota is counted in UTF-16 code units, and the ceiling is measured.** `LOCAL_QUOTA_CHARS` is 5 MiB (headless Chromium answers 5,242,880 exactly); `probeHeadroom(store)` bisects a probe key to the real remainder, counting key plus value. `isQuotaError()` recognises `QuotaExceededError`, `NS_ERROR_DOM_QUOTA_REACHED` and codes 22 and 1014, never `SecurityError`. *gvb-save, quota.*

**#496. A namespace's prefix is the whole key layout.** `createNamespace({ game, prefix })` writes `prefix + name` and nothing else (default `<game>.`), so hand-rolled schemes fit byte for byte. Registering a member twice with options throws, because two call sites disagreeing about a member's shape is the bug. `names()`, `usage()`, `clearAll()` stay inside the prefix. *gvb-save, namespace.*

**#497. A bundle names what it skipped and what it refused.** An import runs each member's own `migrate()`; an unregistered member lands in `skipped`, one failing its `validate()` in `refused`, nothing dropped silently. The namespace has its own `version` and `migrate(slots, from)`. A single-slot envelope carries `slot: name` and another member refuses it; a v1 envelope with no `slot` still imports. *gvb-save, bundles.*

**#498. The IndexedDB tier is the same key and the same bytes, one level up.** `createAsyncSaveSlot()` takes the same options, writes the exact string the sync slot would, and returns promises. With no `storage` it tries IndexedDB (`gvb-save`/`kv`), then localStorage, then memory; `slot.tier` says which. A 12 M-character save wrote in 61 ms where a sync slot hit quota. *gvb-save, IDB tier.*

**#499. A save moves up a tier by a read-time migration that runs once.** An IndexedDB `load()` that finds nothing reads localStorage under the same key, moves the string up verbatim (a version-0 save stays version 0), and removes the copy only after the put succeeds. `clear()` removes the copy below too; `fallback: null` never looks. *gvb-save, promotion.*

**#500. A dead IndexedDB is asked once.** A database that will not open surfaces on the first call, the slot drops to localStorage and never asks again. A quota error is not death and does not demote the slot. *gvb-save, IDB failure.*

**#501. No adopter moved to v2, on purpose.** v2 breaks the README's no-speculative-hooks rule, so it is recorded there under "Not adopted yet". Closing Time's hall was named the namespace's first natural pull; the next feature needing more than 5 MiB or more than one key takes the tier or the namespace rather than a third prefix scheme. *gvb-save, adoption.*

**#502. The browser suite borrows `404.html` as its host page.** `gvb-save.browser.mjs` imports the module by hand into `404.html` rather than shipping a fixture page, because every `.html` here is a live URL that needs an owner (#355) and a test page is not a page. *gvb-save, browser suite.*

**#503. The hall holds finished years and nothing else.** A career is filed the day it reaches 336, on the scorecard `finishCareer()` froze, plus disclosures. An abandoned career gets no row, since a row per "New career" click would bury the years under false starts; the confirm text says so. Filing attempts would be a separate feature. *Closing Time, hall.*

**#504. The career key is a namespace member, at the key it always had.** `createNamespace({ game: "closing-time", prefix: "closingTime." })` with members `save.v1` and `hall` writes `closingTime.save.v1` byte for byte and `closingTime.hall` beside it. First namespace adopter; no bundle export, no IDB tier. Exports gain `slot: "save.v1"`; older files still import. *Closing Time, storage.*

**#505. Enrolment is idempotent on `careerId`, and a legacy id is derived, not rolled.** `makeCareer()` stamps `careerId` from clock and random tail, never the RNG seed. `enrollFinishedCareer()` runs from `finishCareer()` and every `loadSave()`. `repairCareer()` derives a legacy id from a hash of `brokerageId`, `seed`, `day`, `nextId`, `cash`, `xp`, because a rolled id would file the same year once per visit. *Closing Time, enrolment.*

**#506. An imported hall merges and never replaces.** `mergeHall()` appends rows this hall lacks, in recorded order, numbered after existing rows; a row already here keeps its numbers even if the file differs. Replace-on-import would lose whichever machine's hall was exported second. *Closing Time, import.*

**#507. The no-double-filing assertion reads stored bytes, because two guards cover one absence.** Reading back through `loadHall()` stayed green with the enrol-side dedupe deleted, since `repairHall()` also drops duplicate ids. The check reads `JSON.parse(store.getItem(HALL_KEY)).careers.length` and fails on the enrol check alone. Both guards stay; the repair-side one is for imports. *Closing Time, tests.*

**#508. A building is priced by its income, and the ask is not an input.** The commercial branch of `market.js:trueValue()` reads neither `listing.price` nor `listing.condition` and returns NOI divided by cap rate, less capital. The suite doubles the ask on the content file's `listing.price`, the field `trueValue` actually reads, and asserts the value does not move. *Closing Time, commercial.*

**#509. Deferred capital is a line item, not a haircut.** A building's issues come off in dollars, as a buyer underwrites them, where a house's move value through `condition`. The market knows all of it, the player knows what they found, and `investorCeiling()` subtracts the capital the player has found rather than leaving it for a repair credit. *Closing Time, commercial.*

**#510. Rates move a building through the cap rate.** A point of headline rate is 50 bp of cap; neighborhood index is -20 bp per 10%; rent roll expiring this year adds +100 bp times its share; the cap clamps to 4.5% to 14%. 150 bp takes 9.5% off 212 Ferry St while the house next door does not move. *Closing Time, commercial.*

**#511. A commercial financing milestone is a calculation, not a roll.** The loan sizes at 1.20x DSCR on 70% LTV, 25-year amortization, headline rate plus 75 bp, or it fails by the exact dollar shortfall, and `sizingPrice()` gives the price that would work. The suite asserts `S.seed` is unchanged across both branches, and checks the loan constant by amortizing to zero. *Closing Time, financing.*

**#512. A commercial buyer has two walls, and which binds is a fact about the building.** The ceiling is the lower of yield (`NOI / minCap`, less capital found) and money (`rec.budget`). Nadia Brost stops at $1,045,120 on Ferry St by yield and on Ironworks by budget. The offer form treats the yield wall like a budget: 10% stretch, then flat refusal. *Closing Time, buyers.*

**#513. A building has two ways to pay: commercial loan or cash.** FHA and VA are residential programs, so `POOLS.commercial` holds only the new `commercial` `FINANCING` entry (`failBase` 0.03) and `cash`. 45-day floor to close, so `CLOSE_DAY_CHOICES` gained 60. Commercial pays 2% a side against a house's 3% and closes for 200 XP. *Closing Time, financing.*

**#514. The ladder gate covers all three doors a client enters by.** `nextIntakeCandidate()` always filtered by `levelInfo().tiers`, but the Monday free-lead perk and `rollReferral()` picked from `S.clientQueue` unfiltered and could hand a Rookie a 1031 exchange buyer. All three read the same filter now, and the suite asserts each door. *Closing Time, level gating.*

**#515. The commercial tier is buyer-side; the seller side is a different feature.** `seller.js`'s staging, photo and open-house tiers mean nothing for a strip center, which wants a rent roll, offering memorandum and broker's opinion of value. Representing a building's seller is its own row if wanted, recorded in the README's design notes, not opened in `BACKLOG.md`. *Closing Time, scope.*

**#516. The tide runs on walking seconds and does not stop when the sun does.** `main.js` carries a second clock that stops only when the walker does. t = 0 is mid-tide falling, so `tideLevel(0)` is exactly zero and a fresh visit opens on the shipped frame; low water at t = 600, high at 1800, cycle 2,400 s. Nothing is saved. *Golden Hour, tide clock.*

**#517. The tide range is 0.36 m, set by the beach's own furniture.** At +0.18 the swash washes the wrack line and leaves the nearest skipping stone 0.80 m dry; at -0.18 the edge stays 0.30 m inside the static wet-sand strip. The real ceiling is `wadeLimitZ`, a closed-form seabed solve valid only while the highest sea stays under the 0.45 wade depth. *Golden Hour, tide range.*

**#518. One solver for the water's edge, and it changes slope at the shoreline.** `waterLineZ(x, level)` divides by `beachSlope()` above sea level and `seabedSlope(x)` below. Three call sites had each divided by beach slope always: 3.0 m of error at low water. The suite checks against `groundHeight` (stand on the line, sea at your feet), one assertion per regime. *Golden Hour, waterline.*

**#519. Two water levels answer two questions.** `waterY` is this second's surface with the wave; `tideY` removes the wave. State questions (does a pool hold water, is sand wet enough for a print) read `tideY` or they flicker every 9.5 s; "is water over this now" reads `waterY`. `footprints.js` and the wildlife ctx carry both. *Golden Hour, levels.*

**#520. A pool is a pool while the sea is below its rim.** Testing the seaward rim left all five pools empty 36% of the cycle. Against the rim (the pool's carve added back to the heightfield), three pools always hold water and two come and go. Starfish and shannies are logged only from a pool holding water. *Golden Hour, tide pools.*

**#521. `sandHeight` is the beach with the pier taken off it.** The wet-sand strip and foam line read `groundHeight`, which returns pier planking inside the deck, so both climbed 1.9 m onto the deck. `groundHeight` is now `sandHeight` plus the deck where there is one, and anything painting the beach reads `sandHeight`. *Golden Hour, pier.*

**#522. The tide gets no readout, and the surf sound was not retuned for it.** The piece has no HUD; the tells are diegetic (wrack wetted, pools emerging, sanderlings moving, wet sand widening, castles taken). `audio.js` has no distance term and the surf is 9 m further at low water, but tuning it blind is left to the "hour on the beach with ears on" row. *Golden Hour, scope.*

**#523. The hill's climb is the trail's own height profile, read by z.** z is strictly monotone along the trail, so trail height is a function of z; `hillProfile(z)` averages it into 1 m bins, smoothed over ±6 m, and `mountainH` reads it instead of the ramp. Worst bench-above-both-shoulders fell from 10.9 m to 2.1 m, and no trail height moved. Q44 struck. *Blue Hour, terrain.*

**#524. Past the trail's end the hill holds the summit's height; behind the trailhead it keeps falling.** Continuing the climb past the summit made the ground behind the bench dark (luminance 15.4 against a floor of 18). Held flat is the only option with no facing under 18. Behind the trailhead the first leg's slope continues so the creek still leaves downhill. *Blue Hour, summit.*

**#525. Merrit's page moved 30 cm, to 1.5 m off the trail.** At 1.8 m off the trail at t 0.44 the new hill tipped its spot past the walkable gradient (0.96 against 0.85). At 1.5 m, Doyle's distance, no sample in 1,202 is unwalkable. No other page, cairn or the headlamp moved. *Blue Hour, placement.*

**#526. The 10.9 m ceiling became three claims, each documented with what it catches.** (a) `hillProfile` under the centerline is within 0.5 m of the trail: guards the profile, not `mountainH` using it. (b) mean bench-minus-hill over the top half within 1.5 m of zero. (c) nowhere more than 3 m above both shoulders. Plus a fourth for #524's held summit. *Blue Hour, tests.*

**#527. The steam beat frames its box off the camera and reads it before and after the burst.** `__bh.project(x, y, z)` in `main.js` gives a world point as frame fractions. The cab's glass sheen alone read 80 against a median of 26, passing a fixed threshold with no steam drawn, so the beat now demands the burst itself add 18. *Blue Hour, browser suite.*

**#528. In Orbital's browser suite the frame rate is the constraint, and nothing is timed.** Software Chromium runs Orbital at 6 to 7 fps because `drawBg` repaints 160 stars each frame, so the suite flies one shot: First Light's straight 1.57 s line, about 10 s wall clock. Flight is a frame count at fixed DT, so #53 does not reach the file; timing assertions are left out on purpose. *Orbital, test/browser.mjs.*

**#529. A section that throws costs its own checks and no others.** A deliberate break stalled the probe, the flight wait timed out, and the abort took twelve unrelated wipe and clean checks down with it. Each section of `test/browser.mjs` now runs in its own try/catch. *Orbital, test/browser.mjs.*

**#530. The plan and the flight agree on the clock, not only the endpoint.** Asserting `won` passed a 0.9x `MAXSPEED` launch, and the endpoint moved only 0.098 px. The flight time tells them apart (1.572917 s against 1.747917 s) and is asserted as an equality, since `computePlan`'s `solve` and `stepFly` share the fixed-DT stepper. *Orbital, test/browser.mjs.*

**#531. Every sink cell shows the order's cost in tiles, under the order.** Once `×2` is bought, all 201 three-digit orders cost 7 to 14 tiles (100 costs 8, 47 costs 9), so the raw number stops meaning difficulty. The line reads `12 tiles` at 48 px and up, `12t` below, nothing under 34 px; a `tight` class keeps order, mark and cost as three non-overlapping rows. *Integer Foundry, sinks.*

**#532. `place()` reads the cell back.** PR #284's CI failure was a click that landed on a node the factory line re-rendered and placed nothing. `place()` now checks the class and retries up to five times; it cannot double-place because retries only happen on a cell verifiably without the tool. *Integer Foundry, test harness.*

**#533. The three subagents were rewritten against this repo, not copied from Castle Conundrum.** `architect`, `builder` and `scribe` in `.claude/agents/` read `BACKLOG.md`, `WISHLIST.md`, this repo's `HISTORY.md` band, the npm-scripts table and `ARCHIVE.md`, since the originals cited files absent here. Using them is optional; the lead session still claims on `main`, opens the one PR and owns closeout. *Repo process, agents.*

**#534. Signal City's conflicts come from ring geometry, not a hand table.** Each leg has inbound and outbound points on a ring; a movement is a chord; two conflict when endpoints interleave or share an outbound point, which is why a left and the opposing right conflict (they merge). Permissive lefts are exempt from the phase validator and flagged, since yielding is `cars.js`'s job. *Signal City, geometry.*

**#535. Fixed 1/60 s steps, one seeded rng, and a hash.** Every roll goes through `World.rng` in one order, `run(seed)` twice gives one hash, and the browser loop is an accumulator over the same `step()`. Nothing in any suite is timed, so #53 does not reach the project. *Signal City, determinism.*

**#536. Reaction delay is perception, not a timer.** Each car records (s, v, stop verdict, box verdict) every tick in a 90-deep ring, and a follower reads the leader's record and its own verdicts `reaction` seconds back. That produces tailgater chain collisions; aggressive (0.4 s, 0.7 s headway) settles 3 m closer behind a granny than standard. *Signal City, driver model.*

**#537. The box is entered by crossing points.** A conflicting car stops blocking once its rear passes the paths' closest point; a stationary car blocks only if a width-wide probe along my line overlaps it; a permissive left waits 4 m inside and finishes on the all-red. The trucker's sweep is a rule (`wideConflicts`), not off-tracking geometry. *Signal City, box rules.*

**#538. Stars are cumulative and satisfaction never fails a level.** Survive is no gridlock, the throughput floor, and in hard mode no collision. The second star is average wait over every car, cleared or still queued, so a 55 s cycle cannot hide damage in cars it never released. The third is zero collisions (in hard mode, the second star again). *Signal City, scoring.*

**#539. The save key is `signal_city_v1`, through `gvb-save.js`.** `repair` clamps stars to 3, floors bad numbers at 0 and drops null records. Nothing mid-run is saved. *Signal City, storage.*

**#540. Level 1 runs 6% lefts, with targets of 32 cleared and a 15 s average wait.** On a one-lane approach a permissive left holds its queue, which a level 1 player cannot fix; at 12% the longest wait hit 66 s. Targets come from six seeds at 18, 22, 30 and 55 s cycles (22 s: 38 to 49 cleared; 55 s: 32 to 42). *Signal City, First Light.*

**#541. Legs are 110 m and the camera shows the middle 72 m.** Cutting legs to 90 m changed the traffic (cars reached the box faster) and cost the calibrated run a collision, so the physics keeps its tuned geometry and the renderer frames the middle, with wheel zoom. *Signal City, geometry.*

**#542. The browser suite steps the world through `?debug`.** It pauses the loop, calls `__signalCity.step(n)`, and reads the HUD; rAF only draws. This found the HUD refresh gated on `world.tick % 6`, which never moves while paused. Port 8157. *Signal City, browser suite.*

**#543. Signal City is ES modules with a Node suite per module, not a single file.** Devon's brief said single-file; asked, he said to use as much as needed to make it technologically deep. So it follows the house style: plain ES modules under `Projects/signal-city/`, one Node suite per module. *Signal City, structure.*

**#544. Green trust is the fault the all-red clearance exists for.** Without it 1 s and 2 s of all-red were indistinguishable, so the slider was pure cost. Once per approach a driver whose green is coming (`Controller.timeToGreen` finite) or just came rolls `greenTrust` (aggressive 0.6 down to granny 0), anticipates, and ignores cars still crossing. Merges are never trusted. Stem, 12 seeds: 3 collisions at 1 s, 0 at 2 s. *Signal City, cars.js.*

**#545. Level 1 runs a 2 s all-red.** With green trust in, First Light at 1 s collided in 3 of 24 calibration cells, and a tutorial with no slider cannot ask the player to fix that; at 2 s it is 1 in 24. The #540 targets hold and the hint says five seconds. *Signal City, First Light.*

**#546. First come, first served at a four-way stop.** `stoppedAt` is recorded when a car rests at a flashing or dark head, and a conflicting car that stopped earlier and has not entered goes first (ties by id). The 3 s gap rule stays underneath; flashing-yellow majors never stop. The check uses three cars because two passed with the rule deleted. *Signal City, stop behaviour.*

**#547. Queue rules sleep until a level has sensors.** `World.step` passes no sense function unless `level.sensors` is set, so a panel-added `queue` rule is stored, greyed with "needs sensors (M6)", and inert. The panel edits a copy and hands it to `Controller.setRules`, which refuses a rule naming a nonexistent phase and leaves the list untouched. *Signal City, rules.*

**#548. The Stem: N, E, S, target 30, waitTarget 15.** Standard, granny, aggressive (6 : 1.5 : 2.5), 380/380/320 veh/h, 20% lefts, starting at 1 s all-red with the slider unlocked. At 2 s the 18, 22 and 30 s cycles clear 31 to 46. The N leg cannot turn right, so it runs 25% lefts across the opposing through. *Signal City, level 2.*

**#549. Four Ways: a left bay, protected-only lefts, 180 s gridlock wait, target 52, waitTarget 32.** `network.leftLane` makes the inner lane lefts only, because on a shared lane a waiting protected left gridlocked 4 of 6 seeds. The 120 s gridlock wait is ordinary queueing on a 90 s four-phase cycle, so it is 180. 26 s/8 s plan: 59 to 75 cleared. *Signal City, level 3.*

**#550. `standardPhases(legs, { lefts: 'both' })` exists for a shared lane.** Lefts are permissive in their street's through phase and protected on their own (the flashing-yellow-arrow intersection), and the renderer flashes the arrow. No level uses it; it locked as often as protected-only on the shared lane and is kept for a possible corridor level. *Signal City, phases.*

**#551. Unlocks are the level's literal list.** Level 1 unlocks phases and the rule panel (its "auto" is one elapsed rule); the Stem adds sliders; Four Ways adds lefts and flash; Free Play has all plus priority and keeps its 24 s rule. Stars still buy nothing until M8. *Signal City, progression.*

**#552. The arrow lamp draws from a real phase.** A leg whose left has a phase carrying it un-permissively gets a second head showing `head(leg-L)` whatever the through shows, red arrow included; before, it appeared and vanished with the stage. A stem leg with no through shows its right's head on the main lamp. *Signal City, renderer.*

**#553. `tools/calibrate.mjs` is a tool, not a check.** It prints the six-seeds-by-four-cycles table and exits 0. The numbers a level ships with are asserted in `test/scoring.mjs` (three seeds of Four Ways, since a run there costs about 15 s). *Signal City, tooling.*

**#554. A walk is a flag on a through phase, not a phase of its own.** `walks: ['P-N', 'P-S']` on E-W; `standardPhases(legs, { peds: true })` gives each through phase its parallel crossings and lefts phases none. `walksFor` permits exactly what the geometry allows; a separate walk phase would cost every driver a cycle. The constructor refuses a walk its traffic crosses. *Signal City, pedestrians.*

**#555. A call is served when its phase is green, and the green then holds.** `Controller.callPed(leg)` starts a walk if the green just began (`stageT < 0.5`) or `_scheduledEnd()` leaves room for WALK (7 s) plus clearance (from road width at 1.2 m/s), else next green. `_beginYellow` refuses while a walk runs. Past `pedWait` (40 s default) a call counts `stats.pedLate`, costing satisfaction and 5 points. *Signal City, pedestrians.*

**#556. Walkers are bodies on the zebra.** A served call sends 1 to 3 people across at 1.1 to 1.7 m/s; a walker waits at a lane a car is in or will reach within 2.5 s. A car turning onto the leg holds at the box edge (`boxVerdict`, first check) until walkers pass its exit lane. A body over a walker is a strike and a collision. *Signal City, pedestrians.*

**#557. Loops, `after`, and a jump is an insertion.** `sensors: true` hands the controller `World.queued`; `loops` names sensed movements, drawn as dashed 8 m rectangles. A queue rule's `after` is the green it may not cut short (the 4 s minimum locked Crossing on 3 of 6 seeds). After a jump, `resumeAt` sends `next` to where the cycle was. *Signal City, sensors.*

**#558. The corridor is two boxes with their legs laid end to end.** `nodes: 2` builds two Networks `spacing` m apart (220 default); `linkNodes` marks paths leaving A by E with `link = { node, entry, atS }` and refuses a gap. A handed-on car gets a fresh turn, shifted `s` and perception ring, and `newApproach()`. Each node has a controller; drivers read `world.controllerFor(car)`. *Signal City, corridor.*

**#559. The camera frames both boxes; phase 0 is the main street.** A corridor shows 50 m past each outer box, the canvas sized by aspect, drag to pan. The panel drives the selected box (`game.node`). `standardPhases(legs, { main: 'EW' })` puts E-W first because `majorLegs` and a timed plan read phase 0 as the main street. *Signal City, corridor.*

**#560. The box stall is per car.** `boxStall` accumulated across any stationary car, so two permissive lefts in turn read as one 30 s stall and Two Blocks locked; and `touchesBox` placed a truck at its stop line in the box. The stall is `car.stallT` by true front and rear; `touchesBox` stays as the physics was tuned. *Signal City, gridlock.*

**#561. Crossing: Four Ways with calls on every leg, loops in the bays, target 48, waitTarget 36.** Standard, granny, tourist, student (5 : 1 : 1.5 : 1.5), 520/520/400/400 veh/h, 25% lefts, 60 calls an hour a leg, `pedWait` 45, queue rules on N-L and E-L (threshold 3, after 16), 24 s elapsed rule. 26 s/8 s plan clears 55 to 76 at 28 to 37 s wait. *Signal City, level 4.*

**#562. Two Blocks: a 22 s/12 s timed plan, east box 16 s behind, target 80, waitTarget 16.** Standard, aggressive, rideshare, trucker, 520 veh/h into outer main legs, 220 on side streets, 10% lefts. Offset 16 clears 87 to 103 at 9 to 15 s; 30 s cycles lock, so it ships 22. The slider waits for M7 because `_alignToPlan` at a new offset jumps green to red with no yellow. *Signal City, level 5.*

**#563. The offset moves through a transition, the shorter way round.** `Controller.setOffset(o)` owes `d = (o - offset) mod L` and either cuts greens (never below minimum) or stretches by `L - d` (never past twice plan), whichever is fewer seconds. `shift` pays down in `_beginYellow`, then the controller runs in lock step with one built at the new offset. `World.setOffset(s)` sets the east box. *Signal City, green wave.*

**#564. The visualiser is a time-space diagram, forecast from a stepped copy.** `js/wave.js` plots corridor distance across and time down (20 s past, 50 s forecast), box columns coloured by through heads, 14 m/s lines from each green start, main-street cars as dots. `Controller.forecast(movement, seconds)` steps `clone()` at 0.25 s with no sensor. `test/wave.mjs` steps the pure model. *Signal City, green wave.*

**#565. The wave came before the events, and on Two Blocks it runs one way.** #562 deferred the slider by name, so it went first. 220 m at 14 m/s is 15.7 s against the 16 s offset: eastbound-released platoons arrive 0.3 s before green, the other way lands 11.3 s into red. A two-way wave needs travel time of half a cycle; that call is M8's. The 16 s stays. *Signal City, Two Blocks.*

**#566. The first green is not in the log.** The minimum-green assertion measured `green`-to-`yellow` log gaps, but the constructor starts in a green it never logs, so it now reads the stage clock. The forecast-does-not-step assertion captured its reference after the call; it captures before now. Both passed their deliberate breaks until rewritten. *Signal City, tests.*

**#567. Three events, not seven, and they are level data.** The surge, outage and ambulance timer used existing plumbing; the other four needed new geometry or rules and waited. An event is `{ kind, at, for }` in the level; `World.active` holds those in force, `activeEvent(kind)` reads one. Scheduling in the level keeps a run a function of (seed, level, inputs). Unknown kinds throw at start. *Signal City, events.*

**#568. The outage refuses every command that needs power.** During an outage `requestPhase`, `setFlash` (new world door) and `requestPriority` return false and change nothing, and the page disables the buttons; otherwise a phase press brought the box back to green. On return each box goes through all-red to its prior (or queued) phase; flashing or dark boxes return to phase 0. *Signal City, outage.*

**#569. The priority corridor is the whole entry leg and holds until the vehicle is through.** `requestPriority` now greens every movement off the entry leg (W-L, W-T, W-R), since a left at the queue head blocked the ambulance. `_holdPriority` extends the hold to at least 6 s past now while the vehicle is short of its box exit, capped at 60 s from green start. *Signal City, priority.*

**#570. A late ambulance costs five honks and 50 points, and Rush Hour's targets are the corridor's cost.** Satisfaction stays a bonus, so lateness costs five honks in `meters` and 50 in `score`, nothing else. Rush Hour: surge at 60 s for 100 at 1.7, outage at 110 s for 30, ambulance at 185 s with 40 s. Target 56 (not 60, seed-fragile), waitTarget 20. *Signal City, level 6.*

**#571. A platoon obeys the light, and a split is the signal's doing.** A motorcade or procession is `{ kind, at, leg, turn, size, spacing }` with its own archetype (16 m/s/0.8 s, 8 m/s/1.0 s) and `car.platoon`. A split is a member held at its line while another is past the box exit; it counts once (`stats.platoonSplits`) at #570's price. `requestPriority` on a motorcade member covers the whole platoon; processions get no escort. *Signal City, platoons.*

**#572. Pressing the green phase again holds it.** `Controller.holdGreen` restarts the elapsed rule's clock (`heldT`, read by `_runRules` and `_scheduledEnd`) and leaves `stageT` alone. Refused on a timed plan, with a request queued, with no elapsed rule, or during an outage (`World.holdGreen`). The page calls it when `requestPhase` returns false. *Signal City, controls.*

**#573. The lane closure is a zipper, and traffic still arrives in the closed lane.** `{ kind: 'closure', at, for, leg, lane, length }` cones the lane with a 12 m taper (`Network.close`/`open`; `lanesForTurn` omits it). Cars within 40 m merge at their own `s` via `Car.easeLateral` given gap rules, else hold (`car.mergeS`); an open-lane car behind a waiting merger (`car.mergeLane`) takes it as leader in `leaderOf`. *Signal City, closure.*

**#574. The school zone is a speed window and a call multiplier under a beacon.** `{ kind: 'school', at, for, scale, peds }` sets `world.speedScale` (standard cars settle at 7 m/s) and `pedScale()`. The pedestrian Poisson clock runs `pedScale` times faster at the level's rate, so the zone takes effect at once; the vehicle spawner keeps its scheme because #570's targets were calibrated on it. No penalty of its own. *Signal City, school zone.*

**#575. Three zebra rules, because the new boards found three ways to lock the box through a crossing.** A permissive left longer than 4 m that can stop short of an occupied zebra does. A permissive left not yet committed holds for exit walkers at its own yield point. Speed decides who yields: walkers pass a car under 2 m/s, which holds; under 1 m/s strikes nobody. *Signal City, pedestrians.*

**#576. School Run and Main Street ship with targets from calibration.** School Run: 420/360 veh/h, zone at 40 s for 90, W curb lane closed at 150 s, target 88, waitTarget 12. Main Street: motorcade of 5 at 50 s, procession of 8 at 160 s, target 60, waitTarget 20, `boxStall` 45. The level select's scrim centres with `safe` (#132). *Signal City, levels 7 and 8.*

**#577. Event banners are a DOM queue in the board's top-left corner.** Two events at once drew their canvas banners on the same point over the box (School Run at 151 s: SCHOOL ZONE OVER over LANE CLOSED). The renderer keeps the list; the page shows it as an `aria-live` stack, newest last, which the suite can measure. *Signal City, UI pass.*

**#578. The cause of a change is a read-only `Controller.cause`, written where the change starts.** `{ by, t, rule?, text? }`, by one of start, player, rule, plan, offset, corridor, outage, flash; every log entry carries the `by` in force. `requestPhase(i, by = 'player')` lets the world pass 'outage' when the power returns. Nothing reads it to decide anything, and a 300 s four-phase run with the write stubbed out matches change for change. *Signal City, UI pass.*

**#579. The panel is tabs, a level opens on its lesson's, and nothing about the panel is saved.** First Light, Four Ways, Rush Hour, Main Street and Free Play open on Phases; Stem and Two Blocks on Timing; Crossing on Crossings; School Run on Rules. A remembered last tab would be overruled on every level start, so `signal_city_v1` is untouched and has no `repair` change. *Signal City, UI pass.*

**#580. The board fills the window's height, and `fit()` frames the world in whatever rectangle that is.** Sized by the world's aspect, Two Blocks left an empty band under a 430 px board and a single box ran 40 px past a 900 px window. A corridor now shows more of its cross streets; the legs are drawn 60 m past the map edge so no road ends on screen. *Signal City, UI pass.*

**#581. A phase card draws every movement, rights included, from the phase's own list.** The old text dropped the rights. An arrow per movement is what the suite counts against `ctl.phases`, permissive lefts are dashed and walks are bars across their leg. *Signal City, UI pass.*

**#582. A lane is washed green if any movement it carries is green, amber if any is yellow.** Read from `ctl.head`, so a shared lane with a permissive left washes green and a protected left's bay washes only on its arrow. Every stop line also carries a short wash in the colour its lane shows, red included; none while dark. *Signal City, UI pass.*

**#583. Brake lamps are `a < -0.8 m/s²` or standing, and the indicator runs from 45 m before the stop line to the box exit.** Standing is `v < 0.3`: 98.5% of a queue's standing steps already read below -0.8, and the rest are the eased ones a driver still holds. A car waiting at a closure's taper indicates toward the lane it merges into. Both are getters on `Car` (`braking`, `indicator`); asking every car every step leaves the hash unchanged. *Signal City, visual pass.*

**#584. The ground is its own canvas under a transparent board, and a drag slides it.** One canvas with a cached layer cost more than no cache: blitting it took 6.7 ms and a full-board multiply for dusk 9.3 ms under a software Chromium. The ground canvas takes the tint when it is drawn and each car is tinted over its own pixels (`source-atop`). Frames went from 27 to 22 ms (Rush Hour at 115 s) and 5.5 to 3 (First Light). A zoom redraws the ground once per step; a drag redraws it once on release. *Signal City, visual pass.*

**#585. Dusk is a set of level ids in render.js, not a level field.** `DUSK_LEVELS = { 'rush-hour' }` keeps the visual pass out of the level data; night is the outage, whatever the level. If the campaign wants a time of day per level, move it to the level then. *Signal City, visual pass.*

**#586. The cache is guarded by a rebuild counter, not a timing.** A cached-against-rebuilt frame timing passed at 12.5 against 49.5 ms, then failed at 1.2 against 1.0 once the ground had its own canvas, because each canvas defers its draws until read. Flushing both left a 30% gap, too thin for CI. `staticBuilds` holds still across half a second of frames and a drag, and moves once for a zoom and once on release. *Signal City, visual pass.*

**#587. Both increments of the UI pass shipped in one PR, and the row is retired.** Increment 1 was green with room to spare, and the brief allowed going on; one PR carried both. *Signal City, UI pass.*

**#588. The campaign is the eight starred levels in pack order, not six.** The brief's "six levels" was written before M7 added three. Free Play sits outside it and is always open. A level opens on one star from the level before it, or if it has been played at all, so a save from before M8 keeps every board it reached. `start()` does not check the lock: the select only offers open levels, and the suite and `?debug` start any. *Signal City, M8.*

**#589. The campaign adds nothing to the save.** A bought item is its id in `save.unlocks`, the list the save has carried since M4. Stars to spend are stars earned less the price of what `unlocks` holds, never stored. A hand-edited save that owns more than it earned reads 0, not a debt, and an unknown id costs nothing. `signal_city_v1`, `repair` and `migrate` are unchanged. *Signal City, M8.*

**#590. Bought phases go after a level's own, and `next` never reaches them.** Appending keeps every index a plan or a rule names. `next`, from a rule or `requestNext`, cycles only the level's own phases, and from a bought phase it goes on after `lastBase`, the last of the level's own phases to go green. So owning something changes nothing until it is pressed: Rush Hour with all three bought and nothing pressed clears 65 and logs 24 changes, the same as without them. There is no per-run toggle, because an unpressed phase costs nothing. *Signal City, M8.*

**#591. Three things on the shelf: protected turns (3 stars, after Four Ways), extra phases (4, after the Stem), sensors (5, after Crossing).** Protected turns add an arrow phase for each street's lefts, except where a phase already runs that left protected. Extra phases add one phase per leg with every movement off it, except where one of the level's own phases is that leg already (the Stem's stem). Sensors turn on loops in every lane of a level that has rules and no loops. The item shows up in the shop once the level that teaches it has a star. 24 stars are there to earn, and the three items cost 12 together. *Signal City, M8.*

**#592. A timed plan takes no bought phases.** On Two Blocks the offset is the lesson, and nothing on a timed plan would ever press a bought phase, so the level takes nothing from the shop. *Signal City, M8.*

**#593. Roundabout conversion is not on the shelf until M9 builds the roundabout node.** Selling something that does not exist yet would be selling a promise. The row stays open for it. *Signal City, M8.*

**#594. The roundabout node and its sale ship in one increment, and M9 no longer builds the node.** A node no player can reach can only be checked in Node, never against the page (#39), and the sale was one shop row, one branch in `applies` and `loadout`, and a switch. Building the node alone would have shipped code nothing runs. #593's rule held: nothing went on the shelf before the node existed, because both landed in the same PR. *Signal City, M8.*

**#595. The roundabout is one circulating lane, anticlockwise on the screen, and everyone yields to it.** The ring's centre line is 12 m out and 5 m wide; a car joins 0.62 rad before its own leg's axis and leaves 0.62 rad after its exit leg's, so a right turn drives 4 m of ring, a through 23 and a left 42. A car short of its yield line waits while any car on the ring, or already in past its own yield line, or rolling up to its line on a go within 12 m, would reach its join before it could get there plus its reaction plus 1.5 s plus that driver's reaction. An ambulance yields too: a ring has nothing to preempt. The node's controller is built so every caller that indexes `controllers` still works, set dark for good, and the world refuses every command for that node. Each leg flares 1.5 m off its centre line round a splitter island over the 22 m before the yield line: without it a trailer leaving by a leg cut across a car 5 m in on 4 of 12 exits. A two-lane ring is refused rather than built wrong. *Signal City, M8.*

**#596. The ring does not read a car already on the ring as a leader; it reads one merging in.** The first build placed every car on the ring onto every follower's arc as a lane leader. Removing that changed no collision in 36 runs of Free Play's drivers at 1 and 1.4 times demand, because obstacleAhead's probe already stops a car for a body on its line. What did matter is the car past its yield line on its way in: placed at its join less the curve it still has to drive, the ring slows for it early, and without that, 3 of 6 Free Play runs at 1.2 times demand had a collision. The first is gone; the second is the suite's check (#147). *Signal City, M8.*

**#597. A roundabout converts one box, one lane each way, with no walks, no timed plan and no scripted events.** That is First Light, the Stem and Free Play. A corridor's lesson is its offset, a walk needs a signal to call it, and every M7 event is a signal's problem: an outage, an ambulance's corridor, a platoon a light splits. The Stem's all-red lesson goes with its lights, and that is the trade the player is buying. `campaign.js convertible` is the rule; a converted board takes the ring alone and drops any bought phases or loops. *Signal City, M8.*

**#598. The roundabout costs 6, goes on the shelf after Rush Hour, and scores a board on its own calibration.** Rush Hour is where the box goes dark and becomes a four-way stop; the ring is the box built to need no power. At 6 it cannot pay for itself: on a save made under the campaign, Rush Hour's star needs a star on First Light and the Stem, so the ring wins back two on each at most, 4. Each converted board carries `ring: { target, waitTarget }` measured with `tools/calibrate.mjs --ring` on six seeds, because #576's numbers were signals': First Light clears 31 to 53 at 1 to 3 s (30 and 6 s), the Stem 34 to 50 at 0 to 5 s (32 and 8 s), Free Play 84 to 94 at 6 to 18 s (80 and 24 s). A run with nothing to press should not lose a star to its seed, so every target sits under the worst of six seeds. The shelf is 18 stars of 24. *Signal City, M8.*

**#599. The roundabout has an on/off switch, held for the session and never stored.** Unlike a bought phase, which costs nothing unpressed (#590), a ring takes a board's lights away for every run, and a buyer should still be able to play the signals. The owned item's button in the shop is the switch; it starts on at every page load, and `loadout` sees the ring only while it is on. #589 holds: the save gained no field. *Signal City, M8.*

**#600. Every session ends with a handoff prompt for the next one.** Asked for by Devon on 2026-09-23. The prompt a session is started with carried hand-written context (the calls it builds on, what cost time, the suite counts) that only the last session knew, and nothing required writing it down. CLAUDE.md's definition of done item 7 now requires it, and the session prompt in `BACKLOG.md` says so. It lives in the chat, not in a file, because every file here is a live URL and a handoff file would go stale at the next merge. *Process.*

**#601. M9's first increment is the grid and a World that runs it; endless and the sandbox are the second.** The grid is a generator, a per-node network spec, north-south links and the page at up to twelve boxes, and both modes stand on it; together with either mode it is more than one session. #594 shipped the ring with its sale because a node no player can reach can only be checked in Node (#39). The grid is reached through the debug hook, `__signalCity.startGrid(seed, count)`, and `test/browser.mjs` checks it against the DOM there, so the page is covered before a card exists. *Signal City, M9.*

**#602. The crossing cache is keyed by node as well as path.** Every box has a `W0-T`, and `Network.crossing` cached a pair by path key alone, while `boxVerdict` asked box one's Network whatever box the car was at. Boxes with the same spec got the same answer by luck; a box with two lanes asked after a box with one got the one-lane answer: 108.5/111.5 came back where 105.0/115.0 was right. `boxVerdict` now asks the car's own box. All 24 existing runs (nine levels and three rings, seeds 3 and 5) hash as before. *Signal City, M9.*

**#603. A tourist's wrong turn picks from the box it is approaching.** `specialStops` read `world.network.choicesFrom`, box one's paths, so a wrong turn at box two jumped the car 220 m onto box one's geometry. Two Blocks has no tourists, which is why nothing caught it. `test/grid.mjs` sends a tourist certain to turn wrong at box two and failed (node 0, a 220 m jump) before the fix. *Signal City, M9.*

**#604. M9's sandbox is Free Play grown, and endless is a new card.** Free Play already has `sandbox: true`: no stars, always open, nothing recorded. A second card with no stars would duplicate it. The sandbox is Free Play with a choice of district, one box as now (hashing as it does today) or a generated grid with a seed to reroll. Endless needs a best to beat and a day count, and that is a record of its own, so it gets its own card. How the best is stored (a field through `repair`, #36 and #37) is increment 2's call. *Signal City, M9.*

**#605. The generator grows a 4 by 3 district, one box at a time, and never re-rolls a box already built.** The first box stands in the middle cell and is always a signal. Each later box takes an empty cell next to a built one, weighted by built neighbours squared. A box on the district's edge may be a T (chance 0.25), dropping one leg that faces out, so no later box meets a missing leg. A box after the first is a ring with chance 0.2. Every leg gets 150 to 260 vehicles an hour, spawning only while nothing is built on the cell it faces. Every box is one lane each way: joined boxes must agree on lanes and a ring has one (#595). Cell (col, row) sits at (col, row) times 220 m, unshifted, and one generator rolls every step in order, so `growCells(seed, n)` is the first n of `growCells(seed, n + 1)`, which endless needs and the suite holds on twenty seeds. Measured on seeds 1 to 6 with a 20 s rule at every signal over 240 s: 2 boxes clear 68 to 81 with 0 to 1 collisions, 4 boxes 62 to 96 with 0 to 2, 8 boxes 71 to 139 with 0 to 1, 12 boxes 72 to 109 with 0 to 2, and no run gridlocks. *Signal City, M9.*

**#606. On a grid the page names boxes by number, reads one at a time, and frames the whole district.** A grid's boxes are Box 1 to Box N, rings marked, even at two, because two boxes of a grid can stand one above the other. The picker wraps three to a row. The stage and cause lines read the selected box only: twelve boxes on one line did not fit. The ring note and the strip follow the selected box, and on a grid the note drops "switch it off in the shop", because a generated ring has no signals to switch back to. A ring's phase buttons are disabled. The camera may go down to 1.2 px a metre above two boxes: a 4 by 3 district is 760 m across and at 2.5 five of six boxes were off a 1,000 px board. Corridor and single boxes keep 2.5. *Signal City, M9.*

**#607. The mountain's peak is a ceiling over the top, not a new profile.** `summitCap` is centred on the tower, gentle along the spur the last leg climbs (stretch 0.22) and steep across it (1) and behind (1.25), falling toward 0.42 m a metre, smooth-minned into `mountainH` so it only removes ground and faded out below z -50. A round cone was ruled out by arithmetic: the last leg drops 1.4 m in its final 34 m, so any cone steep enough to read as a peak cuts under it. Nothing within 100 m of the trail's end now stands above it (was a 71.3 m ridge 40 m out, 71.8 m at 56 m), and the bench frame reads 19.4 to 32.5 across four facings, all four held above 18 in the browser suite now. *Blue Hour, summit.*

**#608. M9's second increment is endless; the sandbox is the third.** Endless alone is a new card, a day's calibration, a save field, a carry-over and a page flow, and the calibration was the long part: the first target design had to be thrown out (#609). The sandbox (#604, Free Play with a district and a reroll) stands on nothing endless added and goes next. *Signal City, M9.*

**#609. An endless day is 180 s on n boxes (12 at most) with demand 10% up a day, and its target is 20 cars plus 8 a day, uncapped.** A target that followed demand would end runs on the dice: past five boxes a district clears 50 to 130 cars a day whatever its demand and whatever its cycle (12, 20 or 30 s rules measured alike), because a queue backed up to the edge stops cars entering. At three times day one's traffic (day 21) no hands-off run of six locked, so growing traffic alone cannot end a run and a target capped at 50 would have made a hands-off run endless in fact. Uncapped, the target meets the district's capacity: with a 20 s rule at every box on seeds 1 to 6 a run first misses on day 10, 11, 11, 11 and 12, and seed 5 locks on day 2. The wait target is 20 s and only moves points. `node tools/calibrate.mjs endless --endless` reprints the table. *Signal City, M9.*

**#610. A day ends a run by its own verdict: the grid locked or the target missed. Collisions cost points, never the run.** Endless plays soft, like every level but the hard ones. The city seed is rolled per run (1 to 100,000, 7 under `?debug`) so a run is a new city, and the end card names it; Again after a lost run replays the same city from day 1, and the card rolls a new one. Each day's traffic has its own seed, `seed * 1000 + day`. *Signal City, M9.*

**#611. A new day is a new World from `dayLevel(seed, n + 1)`, and every box that stood yesterday keeps its rules and its timing.** Nothing else carries: no cars, no queues, no phase, no flash mode. Rebuilding is the simple way and `growCells`' prefix property (#605) makes it the same city; carrying the rules and timing keeps the player's work, which is what a day survived was. A ring has neither and is skipped. `endless.js carryOver` does it; the page calls it after `play`. *Signal City, M9.*

**#612. Endless's best is `endless: { days, points, seed, runs }` in the save, added through `repair` with an empty default; `signal_city_v1` and version 1 are unchanged.** A save from before it reads `{ 0, 0, null, 0 }` (#36, #37). The best is the most days, then the most points on a tie. It is recorded after every day, so a run left at the select keeps what it survived; `runs` counts a run when its first day ends, because nothing mid-day is saved. Nothing goes into `levels`, so endless earns no stars and moves no wallet. The card opens on a star from Two Blocks, the board that teaches a second box, or once a run is on record. *Signal City, M9.*

**#613. A grid is never converted by the roundabout; the other shop items apply to it as to any board.** `convertible` refused nothing with `cells`: an owned roundabout would have set `roundabout: true` on the whole district's network. It now returns false for a grid. Protected turns, extra phases and sensors go through `loadout` as on any board, built per box from that box's legs (a T gets the phases its three legs allow). All 24 existing runs hash as before. *Signal City, M9.*

**#614. The sandbox's district is chosen on Free Play's card, not in the panel: a row under the card with a stepper from one box to twelve, and the city with a New city button once there is more than one box.** The district is the level, and a World cannot change its network mid-run; the panel drives signals. The choice is the session's and never saved, like the ring's switch (#599). The row is a `div.district`, not a `.level-card`, so every loop over the cards is unchanged. The city is rolled at load (7 under `?debug`, and a reroll adds one there). *Signal City, M9.*

**#615. One box is Free Play itself, the same object, so every one-box run hashes as before; a district is `gridLevel(seed, n)` with Free Play's name, drivers, five minutes, controls and ambulances, and no target.** `grid.js districtLevel(base, seed, count)`. The signals keep the grid's 20 s rule rather than Free Play's 24 s, because the grid's numbers were measured at 20 (#604). With no target the HUD counts cars, the end card names the district and reads "The district ran." or "The district locked.", and nothing is recorded (`sandbox: true`). *Signal City, M9.*

**#616. A scripted arrival on a district comes in on the first box, in build order, that spawns on its leg, or failing that on the first leg that spawns at all; its time and turn are kept.** `spawnCar` does not check `linkedIn`, and box 1 is the district's middle, so its W is joined by twelve boxes on every seed. On 330 districts (seeds 1 to 30, 2 to 12 boxes) 655 of 660 ambulances keep their leg's name and 5 move to another leg. *Signal City, M9.*

**#617. On a district a scripted ambulance raises a banner naming where it came in ("Ambulance at Box 2 W"); on one box it raises none, as before.** At twelve boxes a car is 6 px long at 1.27 px/m, and Free Play's ambulances had no text at all. The banner is the renderer's, so no run changes. *Signal City, M9.*

**#618. The roundabout never converts a district (#613), and the district row says so when the ring is owned and switched on; the card's "+ roundabout" follows the level the card will play.** One box still converts as before. *Signal City, M9.*

**#619. The site's asset pipeline is one dev-only script, `Tools/board-check/asset-pipeline.mjs`, and a decoder it needs is vendored inside the project that reads its output.** Meshopt, not Draco: 24,850 bytes of decoder with its wasm inlined against Draco's 285,747-byte wasm, a 58,763-byte wrapper and a worker, and Draco does not touch animation. A recipe reads its originals from git at a named commit, so it re-runs after they are deleted and writes the same bytes. Every output's raw size has to be under its source's gzipped size, because the host's compression of `.gltf` could not be measured (the sandbox proxy 403s the live site) and a plain `.glb` failed that test at 619 KB against 491 KB. Its packages stay out of `package.json` (`npm i --no-save`, versions pinned in the header), so CI never installs a glTF toolchain. *The site, asset pipeline, increment 1.*

**#620. Bell to Bell's outfits keep the Idle clip and nothing else, and the originals leave the tree.** `poseIdle()` samples the first `/idle/i` clip, Idle in all eight, and nothing plays the other 23. The eight `.gltf` files (25,316,305 bytes) became meshopt `.glb` files (1,638,220) and are in `data/assets.json`'s `_pruned`; git keeps them for the recipe. `tests/characters.mjs` holds each outfit to 1 mm of the original through the game's own loader. The worst measured drift is 0.3 mm. *The site, asset pipeline, increment 1.*

**#621. Bell to Bell ships one texture set and grows no tier picker.** A `pickTier()` like Fourth Quarter's pays where a second tier would show on a real screen; the six props that went to 512 are a 14 cm fire alarm 2.15 m up, a 32 cm clock and four things on a desk seen from 1.65 m, where 512 texels still cover the clipboard's face about 1:1 at 1080p from a metre. The room's tiled surfaces, which fill the screen, kept 1024 and were only re-encoded. So there is nothing for a picker to choose between, and a second set would double what the tree carries. Reversible by re-running the recipe with another size. *The site, asset pipeline, increment 2.*

**#622. Both of Fourth Quarter's texture tiers are a recipe, and `tools/make-textures.mjs` is gone.** It read the 2k files off disk, which stopped being safe the moment the 2k files were re-encoded in place: a second run would have encoded its own output. The recipe `fourth-quarter-textures` reads the downloads from git at `24b6b99` and rewrote all 27 committed 1k files byte for byte with sharp 0.35.4; the 2k set went from 69,218,191 bytes to 22,965,335 at q88 (4:4:4 normals), worst channel 6.14 RMSE at 2048. A file whose re-encode misses #619's byte rule is kept as it came instead of failing the run: 10 of Bell to Bell's small props and 1 of Fourth Quarter's 2k normals. *The site, asset pipeline, increment 2.*

**#623. A texture is held to its error against the original, not to its bytes.** `asset-pipeline.mjs <recipe> --check` decodes every committed texture and fails one whose worst channel RMSE, against the original resized to its size with the same kernel, is over the recipe's ceiling (6 for Bell to Bell, 9 for Fourth Quarter, whose q85 1k leather roughness already reads 8.34) or more than 0.5 worse than the recipe's own encode. The ceiling alone let q60 through; the slack catches q80. It needs sharp and git history, which CI has neither of, so CI holds the other half: each file's width from its JPEG header against the tier its name claims (`assets.mjs`, `smoke-textures.mjs`), because a downscaled file measures clean against a reference of its own size. *The site, asset pipeline, increment 2.*

**#624. Bell to Bell's props are meshopt `.glb` files whose textures stay loose JPEGs beside them.** Embedding would save a request per map and nothing else: a JPEG is no smaller inside a `.glb`, the texture recipe's outputs would stop being files, and `--check` would have to dig them out of the binary chunk. So `bell-to-bell-props` writes each `.glb` with its images named by the same relative URI the `.gltf` used (gltf-transform writes an image with no bytes with no URI either, so the recipe puts them back by index), and the texture recipe checks those URIs in the `.glb` once its `.gltf` is gone. The sources are read at `52d2a59`, where six `.gltf` files already name `*_512.jpg`. Reversible by embedding in the recipe and teaching `--check` to read the chunk. *The site, asset pipeline, increment 3.*

**#625. A prop is held to its original's shape as loaded, before the room rescales it.** `tests/props.mjs` loads each through `createModelLoader().loadStatic()` and measures the raw scene, because `fitFootprint()`/`fitPlane()` divide by the model's own size and would hide one that shrank evenly: per material, vertex box and centroid to 1 mm and UV box and centroid to 0.001, plus the named meshes, the images fetched and the texture slots filled. Measured drift is 0.1 mm and 0.0002. The slots check is the one that catches a missing JPEG, since GLTFLoader logs it and loads the prop untextured. *The site, asset pipeline, increment 3.*

**#626. A conditional row whose condition does not hold ships the check that fails when it starts to, not the feature.** Ranks 2 and 3 on 2026-09-24 were "extend the Anathema suite if the page gains interaction logic" and "build the generator's Chronological merge/sort step if the two views drift". Neither held: `Anathema_Archive.html` had not changed since its suite was written, and the two chronicle views agreed on all 44 rows. Building either would have been the speculative work both rows were written to avoid, and leaving them ranked meant a session re-checking by hand each time. So `anathema.test.mjs` lists the page's 47 input entry points (6 driven by a scenario) and fails on a new one, and `chronicle.test.mjs` fails on drift. The row comes back as a red suite, not as a rank. Reversible by building the feature; the checks stay useful either way. *Pathfinder, ranks 2 and 3.*

**#627. The dossier template is a comment holding a `<template>`, and a suite holds it to the real dossiers.** Rank 4 was "if Devon specifically asks for it"; the batch instruction naming the row is that ask. The comment keeps it out of the DOM and the `<template>` keeps it inert if someone uncomments it. It shows every part any of the nine dossiers uses, once, and its notes make three claims about them. `dossier-template.test.mjs` checks all of it: every class a real dossier uses is in the template, every template class has a rule in the page's `<style>`, every section heading is named, and the three claims hold on every dossier. Without it the template would rot the first time a dossier gained a part. *Pathfinder Characters, rank 4.*

**#628. A conditional row whose condition is a person's decision leaves the ranked table for that person's question, and the page ships a check that fails on the first line of the feature.** Rank 2 on 2026-09-24 was in-browser editing for `characters.html` "if the page's role shifts from showcase to living sheet". #626 does not reach it: no test can see a role change, only code that implements one. Building it (option a) would answer Q39 for Devon, which rule 1 does not license, since the question is not standing in front of any other work. A smaller step (option b, a dossier generator like `campaigns-assets/generator/`) was not asked for either, and #627's template already covers pasting a new dossier. So the row is retired to Q39, which already asked it, and `tests/showcase.test.mjs` fails when either Pathfinder page gains a storage call, a `gvb-save.js` load, an editable field or a script from a file. `campaigns.html` is held too because its rounds 1 and 2 turned the same editing down. Reversible by Devon answering Q39 yes: record it, then narrow the check to the page still a showcase. *Pathfinder Characters, rank 2.*

**#629. Aphelion's touch/gamepad row goes to Q40 under #628, and `test/desktop-input.mjs` fails on the first line of the scheme.** The row was "only if Aphelion ever needs to run on a tablet or phone", which is Q40 and Devon's alone. No honest smaller piece was left. Round 1's arrow-key look already closed the one gap the audit found (pointer lock denied), and a gamepad-only half on desktop was never asked for; building it would be the speculative work the row's own text warned against. The check scans `index.html` and `src/` with comments stripped and fails on a touch event, a non-lock pointer event, a gamepad read, a coarse-pointer or hover query, `touch-action`, device orientation, a second file in `libs/`, a file named for touch or a gamepad, or a changed viewport. Reversible by Devon answering Q40 yes: record it, then delete the rule the scheme trips. *Aphelion, rank 2.*

**#630. A display-less Linux box runs the headed suites under `xvfb-run`, and what it captures is promoted as a draft.** Xvfb adds a screen and nothing else: `launch()` forces SwiftShader on Linux headed or not, so the pixels are the ones every Linux run already made. A beat that scrubs a clock or moves the walker by hand and then reads the result is trusted either way. A real-time movement beat stays inconclusive (#53): six to eight of Golden Hour's fail at about 0.8 fps, and none was "fixed". Golden Hour's recapture and Blue Hour's first preview were both promoted, because a draft that shows the lighthouse, or the trail at all, beats a frame of the old beach and a sealed tile. Both are drafts for rank 1's real-GPU pass. Reversible by recapturing on a real GPU and running `npm run promote golden-hour blue-hour`. *The site, ranks 4 and 9.*

**#631. `play-games.mjs` reads Golden Hour's `?debug` hook after the real-time beats, in the same suite, and Blue Hour's suite does not walk.** The hook beats run on a second boot with `?debug`, after the visitor's page has shown it exposes no `__gh`. They follow #39: the DOM for what just happened (place card, journal page, hint pill), the scene graph where the thing is only pixels (stars, foam line), `__gh.journal()` for what the reload keeps. The stone beat releases pointer lock first, because under Xvfb a held lock turned the camera about 90° mid-throw. Blue Hour's suite checks the hook is shut and the mountain is built, and leaves the climb to `test/browser.mjs`: under #53 a W-hold here could only ever say "maybe". *The site, ranks 6 and 8.*

**#632. A capture recipe may boot with `?debug` to put back the view the page itself gives a visitor, and nothing more.** `enter()` takes a `query`. Blue Hour's recipe uses it for one call, `face(yawAlongTrail(0), 0)`, which is main.js's own spawn view. Engaging pointer lock under Xvfb had sent a mousemove worth +1.452 rad of yaw and +0.88 of pitch, and the first capture was fog sky and one branch. No teleport and no scrubbed clock: those would make a frame no visitor sees. *The site, rank 9.*

**#633. A conditional row whose condition only sets its priority is built when a batch names it; #628 is for conditions that decide what a page is.** Golden Hour's rank 5 was "if night proves popular". Popularity is a person's judgement and the site has no analytics to show it (zero offsite requests), so evidence can never meet the condition; only someone naming the row can, and this batch named it (#627's reading). #628 retired rows whose feature would change the page's kind, a showcase into a sheet or a desktop game onto glass, and building those would have answered Q39 or Q40 for Devon. An owl that hunts and fireflies that drift add motion to a night that already ships and answer nothing. "When it burns" was read as "once it is the brightest thing left", since the fire never goes out: the pull starts at nightT 0.2. Reversible by deleting the two callers of `nightpaths.js`. *Golden Hour, rank 5.*

**#634. Blue Hour's `downhillAt` is the hillside's fall line, and the phantom steps lean toward the valley.** It was the reverse of the trail tangent, which put the pan at exactly 0.000 for a walker facing along the trail, the only way a walker who has just stopped is facing. The fall line of `mountainH` over a 4 m baseline runs across every switchback leg (median 0.95 sideways), so the steps now come from the side the leg below you is on, and the sentence session 4's ladder shipped is true. The eyes' drift and the shape's head-flip read the same function and moved with it on purpose: the shape now shows its profile to a walker facing along the trail, where before it pointed at the camera. Read from `mountainH`, not `groundHeight`, because the trail's bench is cut level across the slope. Reversible by pointing `downhillAt` back at `trailPoint`; `test/browser.mjs` then fails on the pan, by design. *Blue Hour, rank 9.*

---

# The log

One paragraph per phase or batch, oldest first within each project. PR and
decision numbers point into the sections above and into git history.

## The site sessions 1 to 5 (versions 2 to 6)

Session 1 fixed four broken board links, built the wax-seal glyph sprite, the ledger rail and the version line. Session 2 ran a real browser for the first time, found Castle Conundrum broken in production and landed `tools/board-check/`. Session 3 fixed Castle Conundrum's hang and ran board-check clean on Windows. Session 4 vendored three.js into each project's `libs/` and made `harness.mjs` work on Windows. Session 5 mapped the NPC models and turned a playthrough into `npm run play`. Decisions cited: #1, #13, #14, #17, #23.

## The site sessions 6 to 10 (versions 7 to 11)

Session 6 captured all seven previews, added favicons and OG tags, and gave `interaction.js` line of sight. Session 7 made The Fourth Quarter the first `gvb-save.js` adopter and added `npm run games` (94 checks). Session 8 deleted the Bestiary Gallery (3,894 hotlinked images) and took the save module to eleven adopters. Session 9 fixed a direct-commit breakage and a `puppeteer-core` incompatibility. Session 10 fixed the CRLF false-DRIFT in `sync-social-tags.mjs`; `npm run games` went fully green at 146 checks. Lesson: verify a guard-rail by reintroducing its bug (#34).

## Versions 12 to 15

No handoff exists. The repository's history starts at a squashed import on 2026-08-25 with the footer already at version 15, so what sessions 11 to 14 shipped is unknown. Do not guess.

## The prompt rounds, round 1 (site version 8 to 9)

The first parallel round: 22 per-project prompts running at once, one closing prompt applying shared-file requests. Headline finds: Daredevil had never been completable (five wiring bugs, fixed), The Absalom Inheritance was unwinnable at 0 of 2,000 runs (fixed to 59.3%), Final Grade Checker rounded at .45 instead of .5 (fixed), Integer Foundry dealt unfillable orders from order 12 (BFS solver), and Torchbearer's Fighter could never Shield Block. `gvb-save.js` went from one adopter to eleven.

## The prompt rounds, round 2 (site version 9 to 10)

All twenty threads shipped. Final Grade Checker's second grading bug (quality points do not round at .5), an Absalom stall bug in the new Reliquary that only seeded balance runs caught, Daredevil's 356 KB monolith split into four files, a Schedule Visualizer PDF export cut from 21 MB to about 190 KB, and one repo-wide `puppeteer-core` fix. Devon settled three standing questions: Pathfinder pages harmonize rather than share, the committed schedule data stays, and percentages round at .5 while quality points do not.

## The prompt rounds, round 3 (site version 10 to 11)

Every thread shipped. Final Grade Checker's correct quality-point thresholds are whole numbers (4/3/2/1/0), so every `x.75` average had been a letter high for the tool's whole history. Daredevil found its biggest open item: refusing Earl barely changes milestones M2 to M4. Schedule Visualizer's 863,737-byte file became a shell plus a seven-file `Tools/schedule/app/`, verified byte for byte. Orbital got a physics suite covering all 22 levels. The false-DRIFT reported by sixteen projects was root-caused once.

## What the round system got wrong, and what it got right

Two founding facts were false and were corrected in place: the site did make offsite requests (fixed by #44's static sweep), and the suites only drove the seven games (fixed by deleting the Bestiary Gallery and adding `npm run tools`). What outlived the system is the "Questions for Devon" block, now in `BACKLOG.md`. The closing prompt refused to write a handoff from partial notes, by design, and did so in round 2. The fourth round never started.

## School Generator, phases 1 to 18

No per-phase record survives for Phases 1 to 11 because history begins at a squashed import. Phases 12 to 18 are known only by their commit names: the lattice and save v11 (12), the drawing sheet (13), two-person editing (14), a school day (15), cost (16), the meshed site (17) and the server that never shipped (18).

## School Generator, arc four: the guest (Phases 19 to 24)

Shipped a first-visit opening, a Ctrl-K command palette, a coach, a phone layout, five time-of-day moods and lit troffers, `sightline.js` gating walk-mode labels on line of sight, carrying props in walk mode, a shareable walk bundle, and a lights-out night. Phase 19 found the tool never booted on a phone at all. Lesson: sight has its own idea of a wall, so `sightSegments` derives its own occluders rather than reusing `collide.js`'s `wallSegments` (which counts glass as solid and cuts no windows).

## School Generator, arc five: the living school (Phases 25 to 36)

Shipped free-standing `floor.walls`, a press-or-drag eraser, baked light that stops at walls, spatial audio, `weather.js`, a service worker and first-run demo, surface finishes, repeated rooms, directed tours, a readable history, and zoom-following grid snap for every tool. Phase 31 measured transmission at 547 ms to 1,186 ms a frame and moved refraction to photo mode. The TDZ bug (a `let` read above its declaration) shipped three times. Lesson: a phase's premise is checked against the tree, not the wishlist (Phase 32).

## School Generator, arc six: the design review (Phases 37 to 42)

Shipped multi-sheet drawings, dimensions printed on the sheet, arrival and dismissal through real doors, a wheelchair walker with `clearance.js`, code editions in `codes.js` with `commonpath.js`, and a boot diet that took 312 KB and twelve requests off first load. Phase 40's clearance pass found real 33 in pinches in the corridor template. Twelve struck-through backlog items were closed by named phases; three landed partly and stay in the wishlist. Lesson: the walk bundle's cycle check, not runtime, is what catches import cycles.

## Hearth, sprints 4 to 16

A zero-dependency island that round-trips through the URL hash. The sprints added wildlife, blessings and hash saves (with a variable-width 9 to 16 bit LZW that cut the payload to 55%), sound, the mill, prayer and arcs, heirlooms, the walking of the bounds, and songs and news. Recurring traps: `//` comments eating one-line statements, version-pinned asserts in older harness modes, and `rnd()` leaking into audio or click paths. Lesson: assert on durable signals (the chronicle, counts), not transient state or log text.

## Hearth, Phases 6 and 7

Phase 6's first increment added the short winter: a reckoning, rations, a granary raid, an elder who eats last, save v14 and a `strain` mode (#68, #69, #71). Phase 7 cleared five leftovers named by sprint after sprint: a clock-phased play ring, elders telling of the dead they outlived, a weighted prayer draw, and a named birth-cap constant (#79 to #82), with forty-day `pack()` hashes unchanged (#74). Lesson: when an older check goes red on a shifted stream, suspect the check first (#66, six instances).

## Hearth, Phase 8

`hearth-ci.yml` runs `determinism`, `save`, a twelve-day `soak` and a new `pinned` mode on every PR, the other fifteen modes nightly (#83, #84). `pinned` compares forty-day `pack()` hashes against `test/hashes.json` (`41eb3cb5:37275` on seed 7, `4ac7d23d:36964` on 20260819). Lesson: V8's `Math.pow`, `Math.sin` and `Math.cos` differ between releases, so Chromium 151 ran a different island, and the lockfile pins Playwright 1.56.1 exactly.

## The Fourth Quarter, Phases 1 to 3 (PRs #170, #172, #174, #176)

Phase 1 made each room a pure description in `js/layout.js` and held the derivation to a Corner Tap fixture (#182, #184). Phase 2 added three bigger rooms on a 30/44/58/76-seat ladder, annexes (Midtown's back room) and the flagship's mezzanine with `floorYAt()` and one step rule (#185 to #188, #194 to #200). Phase 3 gave every walker an A* nav grid with string-pull and `Route` (#189 to #193). Measured penetration into furniture: 0.000 m in all rooms. Node total 509 to 734.

## The Fourth Quarter, Phases 4 and 5 (PR #178)

Phase 5 put `smoke-engine.mjs`, `smoke-campaign.mjs` and every other `test/*.mjs` on `fourth-quarter-ci.yml` for each PR. Phase 4 cut 27 Poly Haven 2K textures (69,218,191 bytes) to a checked-in 1k set of 5,076,840 bytes, chosen by `pickTier()` with a `?tex=` override (#201, #202): 5.02 s to fully textured at 20 Mbps against 30.86 s. Lesson (#147): counting texture requests on the wire stayed green against a broken cache because Chromium's memory cache answers silently, so the check reads the `LoadingManager` count.

## The Fourth Quarter, Phases 6 and 7 (PRs #179, #183, #185)

Phase 6 added `js/league.js`: an eight-team MAFA double round-robin, calendar as arithmetic on the day, one result shared by TV, box score and standings (#203 to #205). Phase 7 ported regulars, reputation and The End Zone rival (#207 to #211), then put regulars on the floor with nameplates, their usual pre-filled and a first-round comp on E (#212 to #214). Node total 924 to 1,153. Lesson: `freshName()` had two lines guarding one absence, so deleting either stayed green; it now picks from the 300 open names.

## The Fourth Quarter, Phases 8 and 9 (PR #187, Phase 9 PR pending)

Phase 8 put nineteen of the 2D build's 21 event cards on the floor: pure `js/events.js`, `js/moments.js` for the in-room person or prop, a "Night's Moments" box-score section, `eventCd` cooldowns in the save (#215 to #218). Phase 9 made a night losable: `LEASE_STRIKES` nights below `LEASE_FLOOR` evict you one rung down, and only eviction from the Corner Tap sets `failed` (#219 to #222). Node total 1,153 to 1,326. Lesson: three breaks first left the suite green, including dropped upkeep invisible on a campaign owning no gear.

## Faire Weekend, stages 1–22
Stages 1 to 9 built the game: plots, performers, vendors, events, the plan/gates/report loop, terrain-derived `quoteBuild()`, contracts, season, expansion. Stages 11 to 18 added placement rules, 2x2 stages, paths, upkeep, reachability BFS, win/loss. Stage 19 found an empty field earned +$5,420/day and `state.builtPlots` never touched attendance; `computeGroundsDraw` fixed it and the `SIGNIFICANCE:` test class was born. Stage 21 made a day final once gates close (#45) and vendored fonts; Stage 22 adopted `gvb-save.js`. Lesson: build a fresh `createSaveSlot()` per simulated reload in Node suites.

## Faire Weekend, Phase 1: guests who walk and the economy (PR #191, PR #193)
Increment 1 added `GUESTS` archetypes and pure `js/guests.js`: at most 400 sampled agents walk path routes toward attractions with a repeat penalty; the economy stayed put (#223 to #225). Increment 2 made the walk the only source of stall money via `spentAt` and `represents`, ruled the col-3 spur unbuildable, cut `wristbandCut` to 0.12, let the gate take its purse share first and set `stepsPerBlock` to 6 (#226 to #230). SIGNIFICANCE 8 to 10 added. Lesson: scale the buyer count once and price the gross off it.

## Faire Weekend, Phase 2: weather worth checking (PR #195)
Seven-row `WEATHER` table multiplying block heat, gate and mood, with a season weight ramp across `WEATHER_SEASON_SPAN` weekends. Weather is a pure function of a per-save `weatherSeed` and calendar position, so tomorrow's forecast is computable and reloads are stable (#231); `createInitialState` takes a seed and only `newGame()` draws one (#232). HUD slot, Office forecast card, weather-scaled heat pips and a stub row shipped; SIGNIFICANCE 11 asserts shade vs hilltop on mood, not net. `smoke.mjs` 857 to 1,118.

## Faire Weekend, Phase 3: acts with a story (PR #197)
`state.relationships[id]` 0 to 100 per contracted act, moved by what the day did, five tiers, deleted on release. Eight `ARCS` subjects with sixteen beats resolved by `resolveBeat`; `performerFor`/`vendorFor` overlay traits. `quoteContract` is the one rate computation, with inline negotiation of commitment and break fee. `evt_encore` and `evt_late_call` gate on Devoted and Sour. Decisions #235 to #240; SIGNIFICANCE 12 and 13. `smoke.mjs` 1,118 to 1,652.

## Faire Weekend, Phase 4: a faire that outlives its season
Renown as a second track from `weekendRenown` (#241); `closeSeason` banks a `seasonRecord` and opens the next run via `carryoverPreview` (#242, #244); the save slot went to version 2 with the first real `migrateSave` (#243). South Meadow tier and the Gilded Company unlock off renown (#245). Finding for Q27: a scripted manager banked $28,000 to $104,000 but never took reputation past 63, so the reputation bar is out of reach. `smoke.mjs` 1,652 to 1,825.

## Faire Weekend, Phase 5: the layout review
`tools/shoot-states.mjs` photographs seventeen states at four viewports and records live rectangles; it asserts nothing. It measured the Fair Floor tab 1,820px wide at 1280, a 187px brown slab beside the map and a 191px phone HUD. Rulings #246 to #250: plat column as a `calc()` off `--cols`, map `max-content`, tables in `.table-scroll`, touch sizes on `(pointer: coarse)` not width (answering Q29 and Q30). Phone HUD now 137px. Lesson: a block-level grid is its container's width whatever its tracks add up to.

## Faire Weekend, Phase 6: pannable map and build preview (PR #203, PR #205)
Increment 1 replaced the terrain div grid with a canvas: pure `js/mapview.js` geometry, `js/plat.js` painting, DOM markers riding the same transform (#251, #252), drag, pinch, Ctrl+wheel, keys. Increment 2 added pure `previewPlacement()` returning draw deltas, reach and `drops` or a refusal reason (#253), shown in a `role="status"` `.plat-readout` (#254), plus `tools/touch-readout.mjs` (`npm run touch`) under real coarse-pointer Chromium. Lesson: Playwright's `hasTouch` leaves `(pointer: coarse)` false, so touch checks need Blink's flags.

## Faire Weekend, Phase 7: a third crew
`CREW`, six rows over three roles with a `covers` field. The gate is a 550-guest ceiling that gate crews raise (#255); crew are staff with no relationship or renown (#256); the watch scales incident events by uncovered crowd exposure (#257); one `contractedCost()` path (#258); the herald moves overflow measured against `CROWDING_FILL` (#259); Section 1g fixtures had never scheduled an act (#260). The full-run manager now wins season one at reputation 74, relevant to Q27. `smoke.mjs` 1,951 to 2,108.

## Faire Weekend, Phase 8: the wiring audit, automatic
`tests/wiring.mjs` (136 checks) replaces the by-hand grep: every emitted `data-action` must be handled and every handler emitted and exercised by `smoke.mjs` or `play-games.mjs`. First run found `contractCrew` and `releaseCrew` never clicked. It is its own file so it cannot satisfy itself (#262), resolves the interpolated contract-button emitter off call sites (#263), and keeps an allowlist checked from both ends (#264). No game code changed.

## Daredevil arc one, Phase 1 increment 1 (2026-09-10)
Declining Earl at the fair had changed nothing. Shape B (#265): a self-financed Milestone 2 on `rels.earl === 'absent'`, fourteen `m2_solo_*` scenes (promoter, bank, Duke's arithmetic), six new flags including `soloM2`, and a backer-less Free Roam 2 where `fr2_debt_01` must be played first (#266). `triggerStatUpdate` accepts a function for `reason`. New `no_earl_solo` transcript; `smoke-page.mjs` plays a full "Not interested" run to Milestone 5.

## Daredevil arc one, Phase 1 increment 2 (2026-09-10)
From `m3_entry` on, the solo run still read 31 lines of Earl. Decisions #267 to #269: every such line reads a `solo()` helper and names who is there instead (Kessler, Petersen, Cal) across M3, FR3, M4, FR4, M5 and the epilogue; "Earl picks" is hidden. Choice text, subtext and stat-update titles may be functions of state. `smoke-page.mjs` now asserts no `\bEarl\b` from `m3_entry` to the ending; sixth transcript `no_earl_crash` added.

## Daredevil arc one, Phase 2 (2026-09-11)
Four finished pieces of writing were unreachable and two flags could never be true. Decisions #270 to #274: both Free Roam closes routed on both branches, `m2_sign` actually sets `rels.earl` and `m2Complete`, `m5StuntFlags()` makes the Earl-picked ending reachable, one relationship label table, `pressAtFair` cut, and the mentor ending credits Pete. New `test/flags.mjs` (7 assertions) freezes a 28-name write-only list. Lesson: a scene nothing routes to is not an error, so it needs a static reachability check.

## Daredevil arc one, Phase 3 (2026-09-11)
Relationships became a declared table. Decisions #275 to #278: `pete` seeded as `'unknown'`, `CAST` in leaf module `js/cast.js`, route tables walked in their own order by `routeByCast()`, and `setRel()`/`repairState` refusing and repairing illegal states. `_needs` lists built by `statesOf()`/`presentStates()` replace relationship `_requires` closures. `smoke-save.mjs` 53 to 110 sweeps 135 (character, state) mentions. Lesson: the unreachable `ruthie === 'warm'` stayed green three rounds because a comparison against a state nobody reaches is not an error.

## Daredevil arc one, Phase 4 (2026-09-11, PR #220)
Seven of 26 cast states were written by nothing. Decisions #279 to #282: Tommy's three-evening track gated by `tommyAsked`, the debt arm demoting flat, Danny's `poached`/`absent` from `fr3_danny`, and `rosterFor()` for the ending roster. `smoke-save.mjs` gained a state-reachability check with three dead states frozen. Measured, not fixed: choice-reached scenes with a `statUpdate` apply deltas twice (33 frozen); new scenes put numbers in `effects`. Nine transcripts; `smoke-page.mjs` 93 to 136.

## Daredevil arc one, between Phases 4 and 5 (2026-09-11)
Two sessions built Phase 4 the same day because each claimed rank 1 on its own branch. PR #220 shipped and #221 re-ranked; PR #222 was closed unmerged and nothing from it carried forward. Decision #283: a claim counts only once it is merged to `main`, now written into `BACKLOG.md`'s Tier 1 preamble and the root `CLAUDE.md`.

## Daredevil arc two, Phase 5: a walker that knows what it did not reach (2026-09-11)
Shipped `test/graph.mjs`, which builds the story graph from `SCENES` data and `engine.js` text (232 scenes, 24 routes, 412 edges) and walks it plainly and over reachable relationship bags (103,443 states). It found one dead route and one unreachable scene. Decisions #284 to #285. `smoke-save.mjs` went 127 to 134. Lesson: reading the engine as text over-approximates on purpose, so the tool can miss an orphan but never invent one.

## Daredevil arc two, Phase 6: evenings that cost something (2026-09-11)
Added `js/money.js`, a dependency-free hub economy: budgets below card counts, priced evenings, per-hub take, notes via `monthlyOn()`, the $900 bus deposit on the solo branch, and cost tags on every card through one `renderHubShelf()`. The ending screen reads the books back as a fifth verdict. Decisions #286 to #289. `smoke-save.mjs` 134 to 199, 18 planted breaks. Lesson: the double-applied `statUpdate` was found by a transcript, not code, so running totals only move through `effects`.

## Daredevil arc two, Phase 7: three stunts that are three stunts (2026-09-11)
Added `js/stunt.js`: one count per scale derives gap, run-up, top end, landing zone, tolerance and drift, and launch speed is solved from geometry. Retry costs a Condition point once, the Scale pill row is gone, the Recovery result is read, crowd work can fail, and the autopilot aims at the run's own tier. Decisions #290 to #293. `smoke-save.mjs` 199 to 246. Lesson: with the old autopilot constant, cars and buses failed, which is the proof the three scales now differ.

## Daredevil arc two, Phase 8: a workflow that runs the suite (2026-09-11)
Shipped `daredevil-ci.yml`: a fast Node `suite` job, then `browser` (`smoke-page.mjs`, `verify-touch-375.mjs`) and a nine-way `transcripts` matrix, both `needs: suite`. The path filter includes `assets/js/gvb-save.js` and board-check's `harness.mjs` plus lockfile. `transcript.mjs --check` makes transcripts an assertion. Decisions #294 to #296. Closes arc two. Lesson: normalise real-time physics output to its verdict, or CI goes red whenever a runner drops a frame.

## Bell to Bell, the T7 slice and Phase 1: a day with more than two periods
The T7 balance table records the Observation's ambient cost in every period; the 2,000s lesson against a 2,820s period is intentional (`filler`). Phase 1 made a period a row in `data/periods.json`, moved `periodFor()` to `src/periods.js`, migrated six flat keys to namespaced slots via `migrateLegacyKeys()` (locked decision #59, defined elsewhere), carried Bandwidth across the bell (+26 per passing period), and added 6th period with no `.js` change. Lesson: the day-long pool's cost shows in scan time (14s to 4s), not mastery.

## Bell to Bell, Phase 2: kids nobody authored
Seven pure modules (`rng.js`, `roster.js`, `scheduler.js`, `simulate.js`, `generate.js` and others) generate a seeded 7th period whose roster and schedule obey `rosterProblems()`/`scheduleProblems()`, and reroll until two simulated teachers land in `data/generation.json`'s bands. Fifty seeds all landed in band. The seed lives in `p7.seed`. Shipped in one PR with Phase 3. Lesson: the scheduler must ask the August chart's adjacency question, or the chart silently swallows most tells (seed 11).

## Bell to Bell, Phase 3: the semester remembers
`systems/semester.js` keeps a versioned record per class (`entering`, `recordPeriod`, `advanceDay`, `weekSummary`) with overnight retention and Fidelity/Rapport reversion in `CFG.semester`. Admin's three-rung ladder lives in `data/admin.json`, and `ui/week.js` renders the Friday Report. Smoke assertions 257 to 381. Symmetric retention is locked decision #61 (defined elsewhere). Lesson: the wanderer's collapse in 6th and 7th comes from Phase 1's Bandwidth pool, not the semester.

## Blue Hour, sessions 1 to 6
Shipped in PR #8. Sessions added a `?debug` `window.__bh` hook and a browser suite; inverted the altitude blend so the summit is the thickest, darkest air; added adaptive D aeolian drone music and settled the direction as dread, not collection; added the logbook and found mist and breath vapour had never drawn a frame; made chip timing real seconds; walked the descent and deleted a doctrine-breaking sting. Smoke 93 to 104, browser 72 to 95. Lesson: under swiftshader, `dt` clamps to 0.1s, so harness walk distances run at a tenth speed.

## Numina arc one, Phase 1: the skill table becomes a record (2026-09-12)
`tools/extract-skills.mjs` turns 29 pipe tables into `src/_data/skills.json` (236 records under six keys, 189 skills), throwing on unknown headers or cells. `test/skills.test.mjs` runs in `npm test` on every Numina PR. Built HTML is unchanged. Decisions #297 to #299. Lesson: the data exposed source defects (`Lighting` twice, blank Verbals, mid-sentence descriptions) that were logged to the wishlist rather than fixed.

## Numina arc one, Phase 2: a page for every skill, and links between them (2026-09-12)
Two build transforms: skill-row anchors with `§` permalinks, and an autolinker (122 cross-links on 43 pages), plus a filterable `/mechanics/skills/all-skills/` index and nation infobox pruning. Assertions 118 to 130. Decisions #300 to #303. Lesson: an assertion whose condition counts something other than what its message prints cannot fail for the stated reason (#147), so `anchors are distinct within a page` was rewritten.

## Numina arc one, Phase 3 increment 1: the arithmetic (2026-09-12)
`src/js/build-rules.js` prices a build and returns a verdict (caps, granted skills, provisional Staff flags, unpriced purchases), plus extracted Aspect and Foundation lists. No page yet. Assertions 130 to 253. Decisions #304 to #309. Ran on Claude Opus 5 against a Fable 5.1 row. Lesson: an absence test ("no `duplicate-selection` code") passes free when a renamed id never reaches the check, so legal cases now assert `legal === true`.

## Numina arc one, Phase 3 increment 2: the picker (2026-09-12)
`/mechanics/character-builder/` over `offered()`, with pure `build-view.js` and `build-state.js` beside a 156-line `builder.js`. The build persists under `numina.build` and in the URL fragment. Assertions 253 to 341, with `builder.test.mjs` fourth in `npm test`. Decisions #310 to #313. Lesson: Numina CI installs no browser, so after touching `builder.js` the page must be driven by hand.

## Numina arc one, Phase 3 increment 3: the card (2026-09-12)
`renderCard()` in `build-view.js` produces a printable one-page character sheet on `print.css`'s `cardsheet` treatment, shown on screen under the verdict with a print button. Phase 3 leaves `BACKLOG.md`. Assertions 341 to 373. Decisions #314 to #315. Lesson: a `git checkout` of a broken file reverts uncommitted work too, so commit before planting a break.

## Numina arc one, Phase 4: accessibility and mobile pass (2026-09-12)
Shipped all seven audit section B items and two visual nits: map svg as `role="group"`, a skip link to `<main id="main" tabindex="-1">` in all nine templates, `div.table-scroll` replacing `table { display: block }`, era banners as `<h2>`, `aria-pressed` on the theme button, `--gold-text` at 4.80:1, the `hr` sprig gap. Added `Numina/test/a11y/` (own package, pinned Playwright and axe) and an `a11y` CI job. Decisions #316 to #317. Lesson: axe's contrast rule is blind on textured pages, so a green run proved nothing.

## Numina arc one, Phases 5 and 6: come play, and the Excellencies chapter (2026-09-12)
Ported the unconverted Excellencies chapter from the PDF (`skills.json` 189 to 428 skills), enriched the timeline (17 to 18 events), grew `history.md` to 919 words and the glossary by ten terms, and added the `come-play.njk` partial on three pages with no date, price or registration mechanic, reading `site.official.*`. Decisions #318 to #320. Lesson: the quoted-N/A verbal fix failed nothing when reverted, so two assertions were written specifically for it.

## Numina arc one, Phase 7: print packet and offline kit (2026-09-12)
Shipped `/mechanics/packet/`, assembled in the browser by `src/js/packet.js` from chapters listed in `nav.json`, with three prebuilt packets in `packets.json`, and a generated `sw.js` precaching 81 files with an offline banner and an explicit "Update now" (no `skipWaiting`). `sw.js` joined `tools/clean.mjs`'s `GENERATED` list. Decisions #321 to #324. Lesson: an offline test must close the server, since emulated offline and the HTTP cache both let broken checks pass.

## Numina arc one, Phase 8: search and navigation (2026-09-12)
Moved `/search/` to Pagefind's Component UI, added a lazily loaded Ctrl+K search modal (`js/search-modal.js`, 3 KB), generated 195 "See also" links from existing data (Excellency alignment now read from chapter headings), escaped three angle-bracket texts the parser had swallowed, and added `search.mjs` and `html.mjs` (html-validate over 58 pages). CI now also runs on `main`. Decisions #325 to #330. Lesson: `bundle-path` needs the path prefix itself while EleventyHtmlBasePlugin rewrites `href` and `src`.

## Corner & Kettle arc one, Phase 1: the sim without the page (2026-09-13)
Split the game into `js/content.js` and `js/sim.js` (`makeRng` Mulberry32, `freshState`, `createSim`) with one fixed-step clock; the page lost every `Math.random()` and `setInterval`. `drive-save.mjs` stayed 90/0 before and after; new `test/smoke-sim.mjs` (114 assertions) and `corner-kettle-ci.yml`. Decisions #331 to #335. Lesson: `freshState()` left `eventTriggerAt` at 0 and only `repairSave` had been rolling it, so `createSim` now schedules the event itself.

## Corner & Kettle arc one, Phase 2: `test/balance.mjs` (2026-09-13)
Added `test/autopilot.mjs` and `test/balance.mjs`: seeded batches (`0x5EED + i`), three players (patient, eager, shopper), fumble and prestige sweeps, a `BAND` and one exit code, about 22 s in CI. Patient serves 99.0% at $1,927 net a day. Decisions #336 to #340. Lesson: the requested halved-patience break stayed green on ordinary days, so the band gained a prestige-5 stress batch where it fails.

## Corner & Kettle arc one, Phase 3: the Serve gate (2026-09-12)
Answered Q2 with a cue: the Serve button shows "Serve 3/5" and names missing lines. Every ticket line now carries `station` and `apply`, replacing seven page `needsWork` predicates and the barista's copied checks. Fixed S-key serving past the gate, empty-plate serves, and the impossible hand-built Frappe. `smoke-sim.mjs` 114 to 132. Decisions #341 to #343. Lesson: a player-visible cue cannot move a scripted harness number, and should not.

## Corner & Kettle arc one, Phase 4: the page becomes a view (2026-09-12)
`Projects/coffee_shop_sim.html` became a 49-line redirect; the game is `Projects/corner-and-kettle/index.html` loading `js/ui.js` over `stations.js`, `chalkboard.js`, `draw.js` and `sound.js`. Purchases and station actions moved into the sim as tables, the autopilot mirror was deleted, and saves use a 4 s dirty timer. Board card, `landing.html` and `games.mjs` updated in the same PR. `smoke-sim.mjs` 132 to 175. Decisions #344 to #347. Lesson: confirm a `sed` break landed before trusting a green run.

## Corner & Kettle arc two, Phases 5 and 6: staff and regulars (2026-09-13)
Staff gained per-group skill, morale, raises and shift-long training, with `sim.wagesDue()` fixing wages charged for days off. Regulars became records with visits, satisfaction and tolerance, can stop coming, and feed a clamped word-of-mouth multiplier; sales history nudges order picks. `repairBarista()` and `repairRegularRecord()` migrate old saves. `smoke-sim.mjs` 175 to 220; patient net rose to $2,430. Decisions #348 to #349. Lesson: `prestige()` clears baristas, so staff comparisons run 20 straight days without a reopen.

## Site CI, and `Pathfinder/data/` published (2026-09-13)
PR #276, run in a separate worktree. Declared `Pathfinder/data/` a published interface with a README contract, added `site-ci.yml` (board-check plus twelve suites, no path filter), the reusable `suite.yml` template, and `ci-check.mjs` graded against `known-failures.json`. Three Playwright-only browser suites stayed out. Decisions #350 to #353. Lesson: Puppeteer's `page.click` races re-renders; the retry helper must catch both "detached" and "not clickable" errors.

## Five quick backlog rows, one batch (2026-09-13)
Ranks 19, 20, 21, 32 and 38, PR #278. Vendored Prompt Builder's fonts, added `ownership.json`, resolved every local `url()`, fixed the six social-tag failures, hardened Closing Time's `repairCareer()`, and ported Integer Foundry's browser suite to Linux with the retry helper. `known-failures.json` went empty and `npm run check` plus `social:check` exited 0 on `main` for the first time. `gvb-save.test.mjs` now checks the adopter list (thirteen, not eleven). Decisions #354 to #359. Lesson: a timing bug that passes once has proved nothing.

## Four quarter-session rows: a gate, a board run, shared chrome, a parked preview (2026-09-13)
Ranks 1, 20, 23 and 24, PR #284. Replaced Castle Conundrum's gate preview-ball with a built leaf opening to 90 degrees, added its `test/assets.mjs` CI job, made `harness.mjs` drop cancelled requests, added `Pathfinder/tests/shared-chrome.test.mjs`, and parked the castle preview row. Decisions #374 to #379. Lesson: a Poly Haven texture pack's preview sphere loads with no error, so only the shape of what loads can catch it.

## Corner and Kettle Phase 7, a reopening worth doing (2026-09-13)
Rank 1 on Opus 5, PR #280, decisions #360 to #366. Prestige became a trade: beans, a Legacy tree, shop layouts and a reopening ledger overlay. `smoke-sim.mjs` went 220 to 318. Lesson: a 60-day sweep cannot distinguish spending beans well from wasting them (1.069 vs 1.066), so that claim is stated rather than banded (#147); the reopening pays through the spawn floor.

## Corner and Kettle Phases 8 and 9, keyboard and `npm run games` (2026-09-13)
Ranks 1 and 2 on Opus 5, PR #282, decisions #367 to #373. Keys `q` to `p` bind to the rendered station panel with a live legend; `[` `]` wrap; the game joined `play-games.mjs` with 16 checks. Lesson: a beat that waits less than a button's progress-bar duration passes a broken gate, so waits read `sim.cupActionMs()`.

## Every ranked row names a model (2026-09-13)
Decisions #380 and #381, `BACKLOG.md` and `HISTORY.md` only. Every ranked row got a model (15 Opus 5, 15 Fable 5.1, 10 Sonnet 5), and three rows PR #284 had already shipped were deleted, taking the table from 43 to 40 rows without re-ranking.

## The batch caps rise, on a second axis (2026-09-13)
Decision #382, `BACKLOG.md` and `CLAUDE.md` only. Batch caps now depend on Size and on areas spanned, and the session start prompt lives in `BACKLOG.md`. Lesson: nominal one-session batches measure about 800 inserted lines, and every recorded failure was a closeout failure, which scales with areas, not rows.

## Aphelion's airlock and Closing Time buyer financing (2026-09-14)
Ranked rows 1 and 7 on Opus 5, one PR, decisions #383 to #387. `camState` reads heading off `matrixWorld`; Aphelion's airlock beat took `npm run games aphelion` from 11 to 21 checks; Closing Time buyers carry financing types (`smoke.mjs` 127 to 150); an Integer Foundry off-by-one CI caught was fixed in place. Lesson: a flake that a re-run would pass is a bug waiting on the dice.

## The line browser.mjs builds to order moves into Node (2026-09-14)
Follow-up to #387, not a ranked batch, decision #388. `planOrderLine()` moved to `test/order-line.mjs` and `smoke-targets.mjs` checks every order size (94 to 104 checks). Lesson: when a break leaves a suite green, check the break before doubting the check; the first break restored only half the old geometry.

## Numina, August 2026
Audit of the Eleventy rules site (55 pages, about 136,000 words). Kept for its label map (A1 to A7, B1 to B8, C1 to C3, D1 to D4, E1 to E6), which `Numina/WISHLIST.md` still cites. Sections D and E shipped in two early batches; B3, B8 and E4 in batch 2; the B accessibility items went to wishlist Phase 4; A4 is Q34, D4's HTTPS half Q35.

## School Generator, August 2026
Five findings, all addressed in the same pass: CI via `school-generator-ci.yml`, `js/bootcheck.js` boot guard, `nextRoomName` ending "Room 101" duplicates, `test/tools/run.mjs` driving all twelve tools, and a partial boot diet (later extended by Phase 42). `main.js` and `render.js` splits were left alone on purpose. Lesson: the untested parts (boot path, tool layer, deploy gate) held every problem; 1,622 assertions were green.

## Orbital's sectors are data, and a level is a link (2026-09-14)
Ranked row 1 on Opus 5, claim PR #295, merged as PR #296, decisions #396 to #400. A level editor with a one-line codec (`js/levelcode.js`), drafts in the URL hash, and the solver shared between Check and CI. Lesson: driving the real page found three bugs no Node suite could (Escape reaching two handlers, the rail hiding the launch point, pasted links doing nothing).

## Orbital rolls its own sectors (2026-09-14)
Ranked row 1 on Fable 5.1, claim PR #298, merged as PR #299, decisions #401 to #405. `js/generator.js` rolls levels by tier and seed, judged by `validate` and a 1,200-launch census with a decoration test; rolled sectors are share links. `test/generator.mjs` runs in 33 s in CI. Note: a fresh clone needs `npm ci` in `Tools/board-check` before `npm run check`.

## Closing Time's multi-offer escalation wars (2026-09-14)
Ranked row 1 on Opus 5, claim PR #301, merged as PR #302, decisions #406 to #410. Structured escalation clauses resolved by `resolveField()`, a highest-and-best call, and player-written clauses. `smoke.mjs` 150 to 193. Lesson: offers that answered the call must be redated, or `resolveHighestAndBest()` clearing `hbDeadline` expires the whole field the same night.

## Castle Conundrum moved to its own repository (2026-09-15)
Pointer section: 102 decisions (#389 to #394, #411 to #490) moved to `GreyVersusBlue/castle-conundrum`'s `HISTORY.md`. Decision #492: numbering is independent per repo from #491 on. See CASTLE POINTER.

## Castle Conundrum's departure, and what it left behind (2026-09-15)
The tools-and-games half of the two-repo move, decision #491. The project folder, `play-castle.mjs` and its recipes and CI entry were deleted; the board card, preview and og images stayed; `sync-social-tags.mjs` gained a temporary `ELSEWHERE` list; `gvb-save.js` dropped to thirteen adopters. `check`, `social:check` and `ci-check.mjs` stayed green.

## The board card points at the new host (2026-09-15)
Devon relinked the card to `https://greyversusblue.github.io/castle-conundrum/`, decision #493: `ELSEWHERE` deleted, the offsite branch carries it, and the export branch was removed. Open for Devon: the new repo's root no longer serves as static files after its #494 (Vite), so Pages must serve its built `dist/`.

## gvb-save.js v2, 2026-09-16
PR #325 added three additive tiers to `assets/js/gvb-save.js` (392 to 870 lines): measured localStorage quota reporting, namespaces with bundle import/export, and an IndexedDB async slot with one-time promotion from localStorage. The v1 suite and all thirteen adopters passed unchanged; `gvb-save.test.mjs` reached 150 assertions plus a 47-check browser suite in CI. Decisions #494 to #502. No adopter moved on purpose. Lesson: a #34 break once stayed green because the test member's own `validate` refused the file, so tests of one guard must isolate it.

## Closing Time: hall of past careers, 2026-09-16
PR #327 filed each career that reaches day 336 into a hall, kept across "New career", on a seventh desk screen. First adopter of the gvb-save namespace, keeping `closingTime.save.v1` byte for byte beside `closingTime.hall`. `tools/smoke.mjs` 193 to 270. Decisions #503 to #507. Lesson: when two guards cover one absence, assert against the stored bytes, not through a repair path that hides the missing guard.

## Closing Time: commercial tier, 2026-09-16
PR #329 added `js/engine/commercial.js` and the Broker-Track commercial tier: four buildings, three investors, income-based valuation, cap rates tied to interest rates, a deterministic DSCR loan milestone, yield-capped buyers and a commercial financing pool. Also closed two ungated client entry doors. `tools/smoke.mjs` 270 to 359. Decisions #508 to #515. Lesson: assert against the field the code actually reads (`listing.price`), or the test passes with the dispatch deleted.

## Golden Hour: the tide, 2026-09-16
PR #331 gave the beach a 2,400 s tide on a walking-seconds clock, swinging the waterline from z = -9.7 to -0.4. `js/field.js` gained the tide, `waterLineZ`, sand state and pool rules; it also fixed a three-site wrong-slope bug and wet sand climbing the pier. `test/smoke.mjs` 93 to 117. Decisions #516 to #522. Browser runs under Xvfb were inconclusive per #53 and were replaced by `?debug` measurements.

## Blue Hour: the hill climbs at the trail's height, 2026-09-16
PR #334 replaced `mountainH`'s z ramp with `hillProfile(z)`, the trail's own smoothed height by z, so the upper trail no longer rides a causeway (worst stand-proud 10.9 m to 2.1 m) with no trail height moved. Summit held flat, one page moved 30 cm, and the steam beat reframed off the camera. `test/smoke.mjs` 104 to 107. Decisions #523 to #527. Lesson: a comment claiming what an assertion catches must be checked against a break (#147).

## Orbital browser suite and Integer Foundry sink costs, 2026-09-16
PR #335 shipped two rows. Orbital got `test/browser.mjs`, 48 checks in CI, flying one short shot because software rendering runs it at 6 to 7 fps. Integer Foundry sinks show order cost in tiles, and `place()` verifies placement to close the PR #284 race. The board-check README gained its port list (Orbital 8155), and the three `.claude/agents/` were rewritten for this repo. Decisions #528 to #533.

## Signal City, milestones 0 to 4, 2026-09-21
A new game from Devon's brief: program the traffic lights, never the cars. `Projects/signal-city/`, 4,343 lines of ES modules with five suites (234 checks), a board card, Ownership area and CI entry; the 2+ row stays open with milestones 0 to 4 done. Covers ring-geometry conflicts, deterministic 1/60 s steps, perception-ring reaction delay, box rules, scoring, `signal_city_v1`, and level 1. Decisions #534 to #543. Lesson: the browser suite steps the world through `?debug`, never rAF.

## Signal City, milestone 5, 2026-09-21
Signal mechanics 2 to 4, the rule panel and levels 2 and 3 (the Stem, Four Ways), with `tools/calibrate.mjs` committed. Green trust makes the all-red slider matter; First Light moved to 2 s all-red; four-way stops became first come first served. 305 checks across five suites, no storage change. Decisions #544 to #553. Lesson: a two-car test of arrival order passed with the rule deleted, so ordering checks need a case the fallback cannot reproduce.

## Signal City, milestone 6, 2026-09-21
Pedestrians (walks as flags on through phases, served calls, walker bodies), induction loops with `after` and `resumeAt`, the two-box corridor, per-car box stalls, and levels 4 and 5 (Crossing, Two Blocks). 389 checks across five suites; `calibrate.mjs` gained offsets, `--rules` and `--lefts=`. Decisions #554 to #562. Lesson: the handoff's perception-ring shift had no check reading a car's memory until a break stayed green.

## Signal City, M7 first increment, the green wave, 2026-09-21
The offset slider on Two Blocks with a shortest-way transition, and the time-space platoon visualiser in `js/wave.js` with a new `test/wave.mjs` in CI. 460 checks across six suites, no level target moved (Two Blocks keeps offset 16). Decisions #563 to #566. Lesson: the constructor's first green is never logged, so assertions on green length must read the stage clock.

## Signal City, M7 second increment, three events and Rush Hour, 2026-09-21
Level-data events (surge, power outage, ambulance timer), a whole-leg priority corridor held until the vehicle clears, the panel's event line, and level 6, Rush Hour. 512 checks across six suites, no storage change. Decisions #567 to #570. Lesson: Rush Hour's numbers are seed-fragile at the metre, so its target sits below the observed floor.

## Signal City, M7 third increment, four events and levels 7 and 8, 2026-09-22
PR #348 finished milestone 7: motorcade and funeral procession platoons, holding a green by pressing it again, the zipper lane closure, the school zone, three zebra deadlock rules, and levels 7 and 8 (School Run, Main Street). 616 checks across six suites, no storage change, Crossing's calibration unmoved. Decisions #571 to #576. M8, the campaign, is next. Lesson: a #34 break run outside the repo died of `ERR_MODULE_NOT_FOUND`, which is not a catch.

## Signal City, the UI clarity and visual pass, 2026-09-23
PR #352, asked for by Devon ahead of M8, shipped both increments. The UI: a banner queue, green and amber lane washes with a hover preview of each phase, phase cards drawn as diagrams, `Controller.cause` behind a Signal line that names every change's cause, a flashing rule card, a 60 s strip, tabs that open on each level's lesson, and four stats. The visuals: pavement, curbed corners, rooftops, trees and noisy asphalt on a ground canvas drawn once per camera, car shadows, brake lamps and indicators from new read-only `Car` getters, lamp glows, stop-line washes, dusk and night. signals 148 to 163, sim 241 to 252, browser 106 to 156, no storage change. Decisions #577 to #587. Lesson: two first-draft guards stayed green against real breaks (a read-only check on a two-phase run with no hand, a brake-hold check on one car), and a timing guard went red once the ground moved to its own canvas, so the rebuild counter replaced it.

## Signal City, M8 first increment, the campaign and the shop, 2026-09-23
The first increment of M8. The eight starred levels run in pack order, and each is shut until the one before it has a star. `js/campaign.js` works out what is open, the stars to spend and the shop from `save.unlocks`, which needed no new save field. Stars buy three things: protected turns (3), extra phases (4) and sensors (5). `loadout` folds them into a copy of the level. The controller takes the phases through a new `extra` option that appends them after the level's own and keeps `next` off them (`cycle`, `lastBase`, `_after`). The select shows the shut cards, the next level and the shop; bought phases are marked + in the panel, with a note. signals 163 to 176, campaign 22 (new, in Site CI), browser 156 to 169. No storage change. Decisions #588 to #593. Lesson: the first `next` check passed with the fix removed, because from phase 2 of a two-phase cycle `(p + 1) % 2` and `lastBase + 1` both land on 1. Starting from phase 1 separates them (#147).

## Signal City, M8 second increment, the roundabout, 2026-09-23
The rest of M8: a roundabout node, and the shop selling it. `network.js` builds a ring with `roundabout: true` (one lane, a 12 m centre line, splitter islands, yield lines), and `Path.ring`, `ringAngle` and `sAtAngle` place a car on it. `cars.js ringVerdict` is the yield rule, the World builds the node's controller dark and refuses every command for it, and `leaderOf` reads a car merging in. The renderer draws the ring, apron, island, splitters and yield triangles and no heads. The shop sells it at 6 after Rush Hour, for First Light, the Stem and Free Play, each scored on its own ring calibration, and its owned button switches it off for the session. `tools/calibrate.mjs --ring` measures it. Every signalled level hashes the same as before on seed 3. sim 252 to 274, campaign 22 to 35, browser 169 to 182, signals, scoring, wave and sprites unchanged. No storage change. Decisions #594 to #599. Lesson: the first ring build read every car on the ring as a lane leader, and breaking that rule left all 36 mixed runs green; the rule that mattered was the one reading a car on its way in (#596).

## Signal City, M9 first increment, the grid, 2026-09-23
The first increment of M9: a grid of boxes, no new mode. `js/grid.js growCells` grows a 4 by 3 district one box at a time from one seeded generator (the first box a signal, Ts facing out, rings at 0.2, one lane everywhere), and `gridLevel` wraps it in a runnable level. `network.js buildCells` builds a Network per cell and joins neighbours north-south as well as east-west through the same `linkNodes`, refusing a leg that runs into a box with none back and a join of two lane counts. The World runs it unchanged. Two latent bugs from box one went with it: the crossing cache (#602) and the tourist's wrong turn (#603), both caught by a failing check first. The page runs a grid through `__signalCity.startGrid`: boxes by number, the stage line on the selected box, the ring note following the selection, the camera down to 1.2 px/m. Every existing level and ring hashes the same as main on seeds 3 and 5. `test/grid.mjs` is new (34) and in Site CI; browser 182 to 194; signals, sim, scoring, wave, sprites and campaign unchanged. No storage change. Decisions #601 to #606. Lesson: a break that swaps the frontier for every empty cell stayed green, because a cell with no built neighbour weighs 0 squared and is never picked; the break that caught it had to change the weight too.

## Blue Hour, the missing peak, 2026-09-24
Rank 2 of the ranked table, a 1, worked under Opus 5.5 (the row names Opus 5). Before it, `hillProfile` held 65 m flat past the trail's end and the ridge noise did the rest: a ridge 40 m from the trail's end stood at 71.3 m and the ground 20 m behind the tower rose to 70.5 m, the dark mound in every summit frame. `summitCap` in `field.js` is the peak (#607); the bench, the tower and every trail height are where they were. `test/smoke.mjs` 107 to 109: (d) nothing within 100 m out-tops the trail's end, (e) the ground 40 m behind the tower is 8 m below its feet. Each broken once: the cap removed fails both, `behind` at 0 fails only (e) (a flat shoulder out-tops nothing), and the z fade removed is caught by the causeway claims already there. `test/browser.mjs` stays at 95 with the summit's luminance check widened from the arrival facing to four; putting back the shape #524 rejected read 10.0 facing right, a facing the old check never looked at. Lesson: two numbers in the new comment were written before the break that measures them, and one was wrong (a 6.2 m rise that is really 1.9). Write the comment after the break.

## Signal City, M9 second increment, endless, 2026-09-24
The second increment of M9: endless. `js/endless.js` makes day n of a city `dayLevel(seed, n)`: the grid's n boxes (12 at most), demand 10% up a day, 180 s, a target of 20 plus 8 a day. The first target design followed each city's own demand and was thrown out on the calibration: past five boxes a district clears a flat 50 to 130 cars and at 21 days' traffic nothing locks, so only a climbing target ends a run (#609). The page has an Endless card after the levels, shut until Two Blocks has a star; a day's end card reads the day, the run and the best, and its button is Next day or Again. A new day is a new World with every old box's rules and timing carried (#611). The best goes in the save as `endless` through `repair` (#612), and `convertible` now refuses a grid (#613). `tools/calibrate.mjs --endless` prints the table. `test/endless.mjs` is new (39) and in Site CI; browser 194 to 209; the other seven suites unchanged. Every existing level and ring hashes the same as main on seeds 3 and 5. Decisions #608 to #613. Lesson: the first break of `fresh()` crashed the suite on a line that wrote to the missing field before any assertion looked at it; a crash is red but it is not the assertion that claims the break, so the fixture now comes through `repair`. And a copy check on carried rules stayed green against a break, because `setRules` copies anyway; it was deleted (#147).

## Signal City, M9 third increment, the sandbox, 2026-09-24
The last increment of M9, rank 1, a 2+ worked under Opus 5.5 (the row names Fable 5.1). Free Play's card grew a district row: one box, the board as it always was and the same object (#615), or a generated grid of 2 to 12 boxes on a city the player rerolls (#614). `grid.js districtLevel` gives a district Free Play's drivers, five minutes, controls and two ambulances, no target and nothing recorded; the ambulances move to the first box that spawns on their leg (#616), and a banner names the box (#617). The roundabout still converts only the one box (#618). `test/grid.mjs` 34 to 46, browser 209 to 227, the other seven suites unchanged; every level and ring conversion hashes the same as main on seeds 3 and 5. M9 is done, and with it the row. Lesson: the first check that every ambulance spawns asked `spawningLegs`, the helper under test, and stayed green against a `spawningLegs` that ignored every neighbour; it asks the World's `linkedIn` now (#34). And the first browser city put the ambulance on box 1's own W, where a banner hard-wired to Box 1 would have passed: the suite rerolls to city 10, where it moves to Box 2.

## The site, shared asset pipeline, increment 1, 2026-09-24
PR #371. Rank 2, a 2+, worked under Opus 5.5 (the row names Fable 5.1). The row's ~335 MB was stale: Bell to Bell's Phase 6 had already pruned 149 to 77 MB and Fourth Quarter's Phase 4 had added a 1k tier, so the two games stood at 77 and 76 MB. This increment is the mesh leg (#619, #620): `Tools/board-check/asset-pipeline.mjs` with one recipe, Bell to Bell's eight rigged outfits from 25.3 MB of embedded `.gltf` to 1.6 MB of meshopt `.glb` (15.5x raw, 4.0x gzipped), the decoder vendored at `libs/addons/libs/`, and the referenced total from 62,102,693 to 38,424,608 bytes with the budget ceiling cut from 66,000,000 to 40,000,000. `tests/characters.mjs` (59) is new and runs in Site CI; `tests/three-hook.mjs` is the import map said again for Node, so a test can load `models.js` for the first time. Two lessons. `Animation.dispose()` leaves its samplers alive, so `prune()` kept 2,770 of 2,780 accessors until they were disposed by hand. The first draft of the suite skinned every vertex twice (r160's `getVertexPosition` already applies the bones). That was invisible on the originals and read as a 1.1 m error on the compressed files, which render identically. Breaking it three ways named the right assertion each time: the decoder unwired (8 fail, `loads through the game's own loader`), `Death` kept instead of `Idle` (16, the clip name and the clip's bones), positions at 8 bits (11, per-material and whole-body boxes). The Death break also showed that `poseIdle()` ends in the rest pose whatever it sampled, a pre-existing bug now in Bell to Bell's WISHLIST.md. Site CI failed on Integer Foundry's browser suite, here and on main's run 230, and both were races in the test, fixed in this PR: the phone page shared localStorage with a desktop page still autosaving its legacy factory every ~550 ms (it is parked on `about:blank` first now), and a Start over press missed a button that a growing log moved 17 px between measure and press (`startOver()` reads the floor back and presses again). Each break reproduced its CI message verbatim.

## The site, shared asset pipeline, increment 2, textures, 2026-09-24
Rank 1, a 2+, worked under Opus 5.5 (the row names Fable 5.1). Two recipes join `Tools/board-check/asset-pipeline.mjs`, both reading Poly Haven's downloads from git at `24b6b99` with sharp 0.35.4 (#621 to #623). Bell to Bell: 64 textures, 31,091,956 bytes to 8,865,928, the six hand-sized props at 512 and every other map re-encoded at 1024, referenced bytes 38,424,608 to 16,198,599 and the ceiling cut from 40,000,000 to 16,500,000, the 19 old prop maps in `_pruned`. Fourth Quarter: the 2k tier 69,218,191 to 22,965,335 bytes, a Retina laptop fully textured in 13.45 s at 20 Mbps instead of 30.86 and 41.2 s at 5 Mbps instead of 114.5; the 1k tier unchanged byte for byte, so its 4.5x gap to 2k is now just the pixel count, and `smoke-textures.mjs`'s 10x and `measure-load.mjs`'s 5x floors became 4x plus a 24 MB ceiling on 2k. Poly Haven's 1k JPEGs are near q100, which is where most of the saving came from. The first measurement run used 4:2:0 for the packed arm maps and put the clipboard's metalness channel at 13.0 RMSE at 512, the metal clip smeared across the board; data maps are 4:4:4 since. Before/after renders at 1280x800 through a temporary page and a `main` worktree: Bell to Bell's seven views differ by 0.40 to 1.20 RMSE per pixel, Fourth Quarter's Corner Tap at `?tex=2k` by 0.49, nothing visible. Three breaks from green, each named by its own assertion: the clipboard's colour map at q80 (`--check`, "worst channel RMSE 4.08 against the recipe's own 3.14, more than 0.5 worse"; q30 tripped the 6 ceiling at 8.24), a Fourth Quarter 2k file written at 1024 (`smoke-textures`, "is 2048 square (got 1024x1024)", and `--check`'s size rule), and a 1024 arm map under a `_512` name (`assets.mjs`, "is named 512 and is 1024 wide", with the budget also over by 251 KB). Left: increment 3, the props' meshes, which now carries the 512 URIs in their `.gltf` files; the four paintings (1.78 MB) were not touched.

## The site, shared asset pipeline, increment 3, the props' meshes, 2026-09-24
Rank 1, a 2+, worked under Opus 5.5 (the row names Fable 5.1); the last increment, so the row is retired. The recipe `bell-to-bell-props` (#624, #625) rewrote Bell to Bell's eleven props and the picture frame, a `.gltf` and a `.bin` each, as twelve meshopt `.glb` files: 3,821,137 bytes (2,233,041 gzipped) to 1,069,504, every one under its source's gzipped size, the potted plant 1,815 KB to 511. Referenced bytes 16,198,599 to 13,446,966 across 92 files instead of 104, the ceiling cut from 16,500,000 to 13,700,000, the 24 deleted files in `_pruned`. Two runs write the same bytes, and the characters recipe still rewrites its eight byte for byte after `build()` learned to leave textures alone. `tests/props.mjs` (100) is new and runs in Site CI; a temporary page rendering all twelve through the game's loader on this branch and on a `main` worktree agreed to 0.1/255 on every 100-pixel block, and the real game fetched all twelve with a clean console. Where the tolerances bite, found by re-running the recipe coarser: positions at 9 bits fail the display shelves and the rack (`sits in the same box`, `every material's vertices are where they were`), at 8 the plant too; texture coordinates at 9 bits fail the frame and at 8 six props (`texture coordinates are where they were`); 10 bits passes both, still inside a millimetre. Three more breaks: the clipboard `.glb` naming its arm map for its colour map (`clipboard fetches the same images`), a stapler JPEG moved aside (only `every material has the same texture slots filled`, which is why that comment says so), and a colour map renamed to `_1k` (`--check`'s new URI line, `props.mjs`, and `assets.mjs`'s "referenced but missing"). Two things cost time. `node assets.mjs` had never run its checks on Windows: `isMain` compared a `/C:/` URL pathname against a `C:\` path and exited 0 silently, fixed with `fileURLToPath`. And a `git worktree` under the scratchpad put the deepest prop files past 260 characters, which Python's server answered with 404s that looked like missing files; a short path under `%TEMP%` fixed it.

## Pathfinder, three conditional rows, 2026-09-24
Ranks 2 to 4, two ¼ and a ½, all `Pathfinder` and all naming Sonnet 5, worked under Opus 5.5. Rank 1 (the real-hardware pass) needs hardware this machine lacks and stays ranked. Ranks 2 and 3 were conditional, and neither condition held (#626). Rank 3: `Pathfinder/tests/chronicle.test.mjs` (15, no browser) parses `campaigns.html`'s By Character and Chronological views and compares them per org as multisets of (character, scenario, XP, reward, reputation). It also checks the Chronological order by season-number (Beginner Box first, unnumbered last) and each summary line against its rows. 33 Pathfinder and 11 Starfinder rows agree. Rank 2: `anathema.test.mjs` gained a static section (33 to 37) that reads every listener, handled key, `closest()` target and `data-*` action out of the page and fails on one not in its `SURFACE` list, on a listed one that is gone, and on an `addEventListener` in a form it cannot read. Rank 4: a commented-out dossier `<template>` in `characters.html` with notes, and `dossier-template.test.mjs` (10) holding it to the nine dossiers (#627). Both new suites are in Site CI. Nineteen breaks from green, each caught by its own assertion. For chronicle.test.mjs: a By Character row deleted ("every Chronological row is in By Character", plus that character's summary), a Chronological gold figure changed (both multiset lines), two rows swapped ("scenario-number order"), a summary miscounted, a one-shot card's reward changed, and an invented row added. For the surface list: a new listener, a listener on a variable ("in a form this check reads"), a new key, a removed listener ("still on the page"), and a credit naming no scenario. For the template: a class on a real dossier, an unstyled template class, a new heading, a `--` in the comment, a dossier missing HP, a dossier with both backstory and flag, a PFS pill on a Starfinder dossier, and a second template comment. One thing cost time: restoring the page with `git checkout` after a break also threw away the uncommitted template, and seven breaks then ran against a page without one. Commit before breaking.
## Pathfinder, the living-sheet row, 2026-09-24
Rank 2, a ½ in `Pathfinder` naming Fable 5.1, worked under Opus 5.5, alone: rank 1 needs hardware this machine lacks and rank 3 is a 1 in another area. The row was conditional on Devon deciding `characters.html` should become an editable sheet, and he has not, so nothing was built and the row went back to Q39 (#628). `Pathfinder/tests/showcase.test.mjs` (10, no browser, in Site CI) holds both Pathfinder pages to one inline `<script>` each and fails on browser storage, `gvb-save.js`, an input, textarea, select, form or `contenteditable`, and a `src`, `type=module` or `import`. It strips HTML and JS comments first but keeps their newlines, so a failure's line number is the file's; the message names the decision each page rests on. Nine breaks from green, each caught by its own assertion: `localStorage` in the ember block (storage, line 792), `document.cookie` (storage), `contenteditable` on a dossier (editable field, line 296), a `<textarea>` (editable field), a second script with `src` (one-script count and file-script both), a `gvb-save.js` module import, an inline static import, a dynamic `import()`, and `type="module"` (file-script each). The gvb-save import first slipped past the file-script rule, whose static-import pattern only matched at a line start; it matches anywhere now. A storage word inside a JS comment stays green. `gvb-save.js` was not touched. Q38 was struck in the same edit: #627 answered it and the list still carried it.
## Aphelion, the touch/gamepad row, 2026-09-24
Rank 2, a 1 in `Projects/aphelion` naming Opus 5, worked under Opus 5.5, alone: rank 1 needs hardware this machine lacks, and no ¼ in Aphelion's area existed to join it. The row waited on Q40, a person's decision, so nothing was built and the row went back to Q40 (#629, after #628). `Projects/aphelion/test/desktop-input.mjs` (9, no browser, in Site CI beside `smoke-state.mjs`) walks the project, scans every `.html`, `.js` and `.css` outside `test/` and the vendored Three.js with HTML, CSS and JS comments blanked to keep line numbers, and names the file and line of any hit. 28 breaks from green, each caught by its own assertion: `touchstart` by listener, `ontouchmove`, `"touchend"` in `main.js`, a backticked name in an array, `changedTouches`, `'ontouchstart' in window`, `maxTouchPoints` and `TouchEvent` (touch rule); `pointerdown`, `onpointermove`, `pointerType` and `setPointerCapture` (pointer rule); `getGamepads`, a `gamepadconnected` listener, `ongamepadconnected` and a gamepad poll in a new `src/` file (gamepad rule); `(pointer: coarse)`, `(any-pointer:coarse)`, CSS `@media (hover: none)` and `touch-action` (media rule); an inline `<script>` in `index.html` (touch rule); `deviceorientation` and `screen.orientation.lock` (orientation rule); `libs/nipplejs.js` (libs rule); an empty `src/touch.js` (file-name rule); `user-scalable=no` and a second viewport meta (viewport rule); and the walk losing `.html` (the scan-reach rule, plus the viewport rule). That last break first crashed the suite on a missing `index.html` after its assertion printed; the read tolerates it now. A `touchstart` in a JS comment and `gamepad` in an HTML comment stay green. `gvb-save.js` and the storage key were not touched; `smoke-state.mjs` is 23/23.

## The site, board-check: Golden Hour's hook and Blue Hour on the board, 2026-09-24
Ranks 4, 6, 8 and 9, five quarters in `Tools/board-check`, worked under Opus 5.5 (rank 4 names Opus 5, the other three Sonnet 5). Ranks 1 to 3 need hardware. Run under `xvfb-run` (#630). `play-games.mjs golden-hour` is 30 checks. Its 12 new `?debug` beats pass (#631): stars 0 to 1 at `setSunT(1560)`, the headland card and journal page, foam z -6.74 to -0.62 from `setTideT(600)` to `(1800)`, the stone's five-step pill cycle, and a reload that keeps `places [headland]` with `sunT` back at 0.2. Six to eight real-time beats fail as on `main`, which is #53 and was left alone. Two stale assertions in the suite were fixed: the instanced-set cap read `<= 4` against six and failed on every run, and the footprint selector matched "under 60 vertices", which the wrack's 48, 42 and 24 now also meet. Twelve breaks from green, each caught by its own line. `__gh` without `?debug`, stars pinned at 0 (0 -> 0), a no-op `setTideT` (-3.94 -> -3.91), and a journal ignoring its load (`places []`, the page line with it) were run together. A card never shown, `visitPlace` without `render()`, a throw that keeps the override (stuck on "hold click"), and `sunT` starting at 900 ("sun started over" at 900.2, the star lines with it) were run together too. Then `__bh` without `?debug`, and every mesh added straight to Blue Hour's scene dropped. That last break stayed green at `> 10` (92 left) and fails at the new floor of 100. A fog-less Blue Hour dies before the probe, so the suite has no fog clause. Blue Hour is in `games.mjs` with no `saveKey`, and Golden Hour's `gvb:golden-hour` is named so `enter()` wipes it. The capture recipe uses `?debug` for one call (#632). `promote-previews.mjs` takes names, because `candidates/` is untracked and a full promote fails twelve times on PNGs nobody has. Golden Hour's board copy now names the night, the tide, the lighthouse, the stones and the journal on `index.html` and `landing.html`. The Blue Hour card and landing row carry the new still, and social tags were regenerated. `npm run check`, `social:check` and `ci-check.mjs` are green. Golden Hour smoke 117, Blue Hour smoke 109, Aphelion 23 and 9.

## Golden Hour's night moves and Blue Hour's fall line, 2026-09-24
Ranks 5 and 9, two ½ rows in two areas, both naming Fable 5.1, worked under Opus 5.5. Ranks 1 to 4 and 6 to 8 need a real GPU, a phone or ears. Rank 5 was conditional on night proving popular; the condition sets priority, not what the page is, so it was built (#633). `js/creatures/nightpaths.js` holds both movers as pure clocks beside `field.js`, which now owns `CAMP` (campfire.js re-exports it). The fourteen fireflies nearest the camp, 25 to 41 m out, leave the hollows on their own onsets from nightT 0.2 and are all 3 to 6.5 m from the fire by 0.60, each bowing up to 4 m off the straight line. The owl hunts every 80 to 140 s of night: a glide that steepens into a stoop 12 to 20 m from its snag, on dry dune sand and on the side away from the walker, 1.2 s in the grass at 0.15 m, and a climb back to the nearer snag, never over 4.7 m/s. The first draft of the onsets (0.26 to 0.44, span 0.2) put all fourteen in transit at once; the "ones and twos" check caught it. Rank 9 went the other way from "accept the zero": `downhillAt` is `fallLine`, the raw hillside's 4 m gradient (#634). The pan reads ±0.835 at the suite's staged stop, toward the valley, and the descending shape now shows a clear profile in 7 of 8 stagings where session 6 measured 0.02 to 0.25. `smoke.mjs` 117 to 135 in Golden Hour, 109 to 113 in Blue Hour, `test/browser.mjs` 95 to 96 (96/0 under Xvfb, real-time beats included, #53 says that proves nothing either way), `play-games.mjs golden-hour` 30 to 33 with the 7 real-time failures `main` already had. Breaks from green, each caught by its own line: in Golden Hour's smoke, fireflies drawn farthest-first, `ringMin` 1.0, one onset for all, `span` 0.5 (the arrival line plus two), `bow` 40, drift height ignoring the dunes (-2.64 m), hunt targets off the dunes, the ground clamp removed (0.149 m, a millimetre under its floor, and the suite says so), `grass` 0.6, no time in the grass, `dur` 3 (the speed line, 15.5 m/s) and hunting beside the walker (3.7 m). In Blue Hour's smoke, the trail tangent (the sideways line, median 0.00), the uphill sign, the benched `groundHeight` (the up-mountain line, -0.37) and an unnormalised vector. In `browser.mjs`, the trail tangent back (`pan -0.000` both ways) and the fall line reversed (the valley line alone). In `play-games.mjs`, BREAKS_PLACEHOLDER. Commit before breaking; the breaks ran in `git worktree` copies so the branch was never dirty.
