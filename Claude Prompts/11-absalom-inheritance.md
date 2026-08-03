# 11 — The Absalom Inheritance

You are working on The Absalom Inheritance, an isometric CRPG built on the Pathfinder 2e
Remaster rules, on greyversusblue.com. It carries `class="has-suite"` on the board. **Round 3
closed what round 2 called the single highest-value gap: character creation now has a real pick
screen with more than one build.** The next headline item is Reactions (Shield Block, Attack of
Opportunity) — see "Your task." This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/absalom_inheritance.html` — the shell: chrome, CSS, element ids. The real logic
  lives next door.
- `Projects/absalom-inheritance/` — `js/` (rules.js, world.js, content.js, game.js, save.js,
  render.js, ui.js, main.js), `content/vault.json`, `test/` (smoke.mjs, balance.mjs,
  autopilot.mjs), `content-authoring-guide.md`, `README.md`.

**The board URL never moved.** `Projects/absalom_inheritance.html` is still what
`/Projects/absalom_inheritance.html` resolves to. Don't propose moving this to
`Projects/absalom-inheritance/index.html`.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this same
repo at the same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 22. |
| `Pathfinder/**` | Prompts 01, 02, 03. `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't build a runtime dependency on it. Whether it's a published interface or private to prompts 01-03 is a real open question, raised by you and Torchbearer independently a fourth and fifth time now — see prompt 01's "Questions for Devon" block, which now tracks it centrally. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `assets/previews/absalom-inheritance.jpg`, `assets/og/absalom-inheritance.jpg` | Generated. Prompt 22. Unchanged this round — the existing mid-combat capture is still accurate; nothing about the sanctum needs to be in the shot. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`; your
edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. **`Claude Prompts/notes/11-absalom-inheritance-notes.md`** — round 3's session: the
   character-creation pick screen (`pcOptions`, `selectPc()`, the picker modal) and a second build
   (a Fighter, alongside the original Wizard), verified through the balance harness at both builds.
   Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/11-absalom-inheritance-notes.md` — the second area (the
   Reliquary), and the stall bug the balance harness caught that a browser playthrough never would
   have. Round 1's are at `Claude Prompts/archive/round-1/notes/11-absalom-inheritance-notes.md` —
   the unwinnable-to-59.3% fix, the ES-module restructure, the save/keyboard/mobile work.
3. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58) and §8 (backlog state, including
   the `Pathfinder/data/` question, raised again this round).
4. `assets/js/gvb-save.js` and `assets/js/README.md`. Your own `js/save.js` is a worked example.
5. `Projects/absalom-inheritance/content-authoring-guide.md` §11 — now documents what a second area
   actually needed (six files, two real bugs found along the way), so a session adding a third area
   doesn't repeat either mistake.
6. Locked decision #3 in `gvb-site-handoff-v1.md` §3, so you understand why this sits under
   Quests, not the board's Pathfinder section.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** `check-integrity.mjs`'s static sweep covers this now.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). This game's is
  `absalom-inheritance-save-v1`, schema version 1, permanent.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37). This
  round's own save changes (`fog` as a per-area map instead of one string, creature keys gaining
  an area prefix) both went through `repair` as migrations of the existing shape, not a version
  bump — see below for the one subtlety in the creature-key migration.
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what
  a reload has to survive** (locked decision #39).
- **A creature's storage key is its *original placement* coordinates, never its current
  position** — this is what makes the round-2 creature-key migration (`"id@x,y"` → `"<areaId>:id@x,y"`)
  land on the existing placement instead of duplicating it. Don't "fix" the key to track where a
  creature actually is; that would break the migration's own assumption.
- **A real-time or timing-based assertion isn't a concern for this project** — it's canvas-rendered
  but turn-based, no real-time physics. Locked decision #53 (Linux/software-rendered Chromium being
  slow for three.js movement) doesn't apply here.

## What is actually here

**Two areas now, not one: the vault and the sanctum.** `content/vault.json`'s `area` singular
became `areas` (keyed by id) plus `startArea` and `areaOrder`. A `stairs` tile in the vault's boss
chamber — past the Keeper — leads to `sanctum` ("The Reliquary"), a 14×10 room with its own
guardian and one optional lore plaque. The Keeper still has to die first: `treasure.requiresDown`
names both bosses, checked against `run.creatures` as a whole regardless of which area either
stands in.

**The engine didn't have a second-area shape at all, so this touched every module.** `content.js`
parses multiple areas and a `stairs` tile kind. `world.js` gained `TILE.STAIRS`. `game.js`'s `area`
and `world` are now getters, reassigned by `transitionTo()` — a value captured once at construction
would go stale the instant a transition happened (it did, the first time this was wired without
noticing). `run.creatures` holds every creature from every area from the start of a run, each tagged
with its own `area`; `living()`/`awake()` filter to the current one. `save.js`'s `repair` migrates
a single `explored` string to `fog: {[areaId]: explored}` and an unprefixed creature key to an
area-prefixed one. `render.js` re-fits the canvas on an area change even when the CSS box hasn't
moved — two areas can differ in grid size with the browser window doing nothing.

**A real bug was found and fixed via the balance harness, not a browser playthrough.**
`test/balance.mjs` went straight to a wall of "unfinished" results at full HP the first time it ran
against the finished feature — not a low win rate, a stall. `checkStairs()` correctly refused to
fire mid-combat, and then nothing re-asked the question once a fight ended: a Stride taken to close
on the Keeper can land exactly on a stairway square mid-fight, the encounter resolves, and the PC is
standing on a stairway in explore mode with nothing ever noticing. Fixed by giving `checkStairs()`
the same standing-condition treatment `checkTreasure()` already had — called from `endCombat()` and
`begin()`, not only from the per-square trigger inside `walkTo()`. **This is the kind of bug that
looks fine from the driver's seat**: one browser playthrough resolves the Keeper fight and keeps
walking, nothing about the outcome looks wrong. Only a few thousand seeded runs turned "occasionally
nothing happens" into a number worth investigating.

**The reliquary warden's stats were measured, not tuned by feel.** At full sentinel stats,
`balance.mjs` measured 41.5% wins over 2000 runs — just under the 45% floor. Weakened, it measures
**53.6%** (down from round 1's 59.3% — a fourth mandatory fight after two others is expensive even
at reduced strength, and that's the honest one-line summary if a future session wants lore-optional
side content instead of another mandatory encounter).

**Test coverage: 308 assertions in `test/smoke.mjs`** (was 281), plus the 2000-run balance check —
now measured against **two builds**: Wizard 53.6% (round 2's number, unchanged), Fighter 79.8%
(new), both comfortably in the 45-90% band.

```
node Projects/absalom-inheritance/test/smoke.mjs
node Projects/absalom-inheritance/test/balance.mjs 2000
```

**How much game is there now?** Two rooms, four mandatory fights, three lore pieces, one rest, one
casket, two selectable builds. Call it 12-16 minutes for a first completion per build.

**The `Pathfinder/data/` question is still unresolved** — raised again this round, a sixth time
site-wide (jointly with Torchbearer). See prompt 01's "Questions for Devon" block.

## Your task

Round 3 closed character creation — a real pick screen, two builds, both balance-verified.
What's left:

1. **Reactions — Shield Block, Attack of Opportunity — now the single highest-value item.** Needs
   a real interrupt point in the turn loop that doesn't exist yet. **Re-run `test/balance.mjs`
   afterward, against both builds** — Attack of Opportunity changes how safe it is to walk past
   anything with a melee reach, and every round's balance numbers so far assume it doesn't exist.
2. **A true PF2e cone template.** Roughly 30 lines per the original estimate. Pair with a
   `balance.mjs` run against both builds — it will shift Breathe Fire's actual hit rate slightly.
3. **A third build**, per round 3's own next-session suggestion, now that the picker infrastructure
   exists — the marginal cost of a third option is much lower than building the picker was.
4. **A hint-bar line on area transition.** `transitionTo()` writes a narrative log line, but the
   hint bar at the bottom of the board doesn't update — it still reads whatever it said before
   crossing. Cheap, cosmetic, only worth doing if you're already touching `ui.js`'s event handler
   for something else.
5. **A third area, or extending the sanctum further** — only if Devon wants more content;
   `content-authoring-guide.md` §11 has the honest cost (same six files as round 2, nothing
   structurally new).
6. **`Pathfinder/data/`** — see prompt 01's "Questions for Devon" block. Don't build a runtime
   dependency on it.

**A durable process note worth keeping in mind regardless of which task you pick:** the balance
harness has now paid for itself twice, on two different bugs neither round would have found by
playing the game once. If your work touches combat math or a transition at all, use the harness
rather than reasoning from the stat blocks.

## Verification

```
node Projects/absalom-inheritance/test/smoke.mjs
  → 308 passed, 0 failed — SMOKE OK

node Projects/absalom-inheritance/test/balance.mjs 2000
  → BALANCE OK for both builds — Wizard ~53.6%, Fighter ~79.8%, both comfortably inside the
    45-90% band (a small drift run to run isn't a problem — that's why the band exists)
```

If you add content or touch combat math, extend `smoke.mjs` and re-run `balance.mjs` — a content
edit that makes the adventure unwinnable should fail the build, not ship.

- Open the page in a real browser and play through whatever you added, keyboard-only and with a
  mouse. **A note from round 2**: this environment's `computer{action:"screenshot"}` and
  `computer{action:"key"}` input paths may not reach the page at all (confirmed by a raw `keydown`
  listener seeing zero events from the tool, though a real `KeyboardEvent` dispatched from script
  works fine) — if that's your environment too, verify against the DOM, `window.__absalom`, and
  dispatched `KeyboardEvent`s instead (locked decision #39 prefers this anyway for anything that
  just happened).
- If you touch the save shape, test the full round trip by hand, then export/clear/import, then a
  deliberately corrupt file.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round as
  files are added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch
  it fail.
- This game is not part of `play-games.mjs`'s beat suite — only the preview-capture recipe in
  `games.mjs`.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/11-absalom-inheritance-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v*.md` gets assembled from all twenty-two of them each round.

Use these headings:

```
# The Absalom Inheritance — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths.
- **What I verified** — actual commands, actual output. Include the save round trip and the
  corrupt-file test. "Should work" is not verification.
- **Shared-file requests** — anything you need from `Pathfinder/data/`, any `gvb-save.js` gap with
  the exact hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort. Be honest about how much game there is; that
  number is the most useful thing you can hand forward.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
