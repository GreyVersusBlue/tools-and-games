# 11 — The Absalom Inheritance

You are working on The Absalom Inheritance, an isometric CRPG built on the Pathfinder 2e
Remaster rules, on greyversusblue.com. It carries `class="has-suite"` on the board. Round 2
built a second area — the cheapest thing that doubles play time, per round 1's own ranking —
and found a real stall bug along the way that a browser playthrough would never have caught.
**The single biggest remaining gap is now character creation: one fixed PC, no build, no
choice outside tactics.** This prompt is self-contained.

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
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `Pathfinder/**` | Prompts 01, 02, 03. `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't build a runtime dependency on it. Whether it's a published interface or private to prompts 01-03 is a real open question, raised by you and Torchbearer independently a fourth and fifth time now — see prompt 01's "Questions for Devon" block, which now tracks it centrally. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/absalom-inheritance.jpg`, `assets/og/absalom-inheritance.jpg` | Generated. Prompt 21. Unchanged this round — the existing mid-combat capture is still accurate; nothing about the sanctum needs to be in the shot. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
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
2. **`Claude Prompts/notes/11-absalom-inheritance-notes.md`** — round 2's session: a second area
   (the Reliquary, past the vault's Keeper), five of eight engine files touched to give "which area
   is the PC in" a real answer for the first time, and a real stall bug the balance harness caught
   (a boss defeated mid-Stride onto a stairway square, in explore mode, with nothing ever noticing).
   Round 1's notes are archived at `Claude Prompts/archive/round-1/notes/11-absalom-inheritance-notes.md`
   — the unwinnable-to-59.3% fix, the ES-module restructure, the save/keyboard/mobile work.
3. `gvb-site-handoff-v9.md` §10 (locked decisions — #51-53 new) and §8 (backlog state, including
   the `Pathfinder/data/` question raised again this round).
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

**Test coverage: 281 assertions in `test/smoke.mjs`** (was 244), plus the 2000-run balance check.

```
node Projects/absalom-inheritance/test/smoke.mjs
node Projects/absalom-inheritance/test/balance.mjs 2000
```

**How much game is there now?** Two rooms, four mandatory fights, three lore pieces, one rest, one
casket. Call it 12-16 minutes for a first completion, up from round 1's 8-12 — the second area
roughly adds what it cost to build it.

**The `Pathfinder/data/` question is still unresolved** — raised again this round, a fourth and
fifth time site-wide (jointly with Torchbearer). See prompt 01's "Questions for Devon" block.

## Your task

Round 2 spent its whole session on the second area — five of eight engine files, plus the balance
re-verification at every step, plus the stall bug. Priorities 2-4 from the previous round are
untouched, and the second area makes the first of them more valuable than it was, not less:

1. **Something to choose at character creation — now the single highest-value item.** Still one
   fixed Human Wizard 1, no build, no choice outside tactics. `pc` is one object in the pack; an
   array with a pick screen is the change, and `defaults` in `save.js` is already a factory for
   exactly this reason. Two rooms now exist to replay through with a different build, which is what
   makes this worth more now than it was after round 1.
2. **Reactions — Shield Block, Attack of Opportunity.** Needs a real interrupt point in the turn
   loop that doesn't exist yet. **Re-run `test/balance.mjs` afterward** — Attack of Opportunity
   changes how safe it is to walk past anything with a melee reach, and both rounds' balance bands
   assume it doesn't exist.
3. **A true PF2e cone template.** Roughly 30 lines per the original estimate. Pair with a
   `balance.mjs` run — it will shift Breathe Fire's actual hit rate slightly.
4. **A hint-bar line on area transition.** `transitionTo()` writes a narrative log line, but the
   hint bar at the bottom of the board doesn't update — it still reads whatever it said before
   crossing. Cheap, cosmetic, only worth doing if you're already touching `ui.js`'s event handler
   for something else.
5. **A third area, or extending the sanctum further** — only if Devon wants more content;
   `content-authoring-guide.md` §11 has the honest cost (same six files as this round, nothing
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
  → 281 passed, 0 failed — SMOKE OK

node Projects/absalom-inheritance/test/balance.mjs 2000
  → BALANCE OK — somewhere in the 45-90% band (round 2 measured 53.6%; a fresh 2000-run
    should land at or near that number, but a small drift isn't a problem — that's why the
    band exists)
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
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
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
`gvb-site-handoff-v*.md` gets assembled from all twenty-one of them each round.

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
