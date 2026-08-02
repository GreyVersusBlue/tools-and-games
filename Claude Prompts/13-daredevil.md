# 13 — Daredevil

You are working on Daredevil, a narrative game on greyversusblue.com. Round 2 restructured it
from a 356 KB monolith into `Projects/daredevil/` (four files), now that a full regression
suite existed to prove nothing broke — the split round 1 deliberately deferred. It also wired
the previously-unreachable "Work the Crowd" minigame and fixed two continuity holes in the
prose. Read `Claude Prompts/notes/13-daredevil-notes.md` first — it carries the plot synopsis
and the full account of both rounds' work.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/daredevil/` — the real game now: `index.html` (505 lines — head, CSS, body,
  one `<script type="module" src="./js/engine.js">`), `js/state.js` (the leaf module), `js/scenes.js`
  (the story, as data — `SCENES`), `js/engine.js` (screens, rendering, hubs, minigames, epilogue,
  boot), `js/save.js` (unchanged), `js/README.md` (new — documents this project's content schema),
  `fonts/`, `test/` (`smoke-save.mjs`, `smoke-page.mjs`, `drive-daredevil.mjs`, `transcript.mjs`,
  `transcripts/`)
- `Projects/daredevil_r4.html` — **now a redirect stub**, not the game. `noindex`, a
  `meta http-equiv="refresh"` to `daredevil/`, a canonical link. Keep it a stub; don't put game
  logic back into it.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this same
repo at the same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 22. Its card now points at `Projects/daredevil/` directly — applied this round, see below. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 22. `daredevil.jpg` in each, recaptured this round against the new restructured path. |
| `Tools/board-check/**`, including `games.mjs`'s Daredevil recipe (repointed at `/Projects/daredevil/index.html` this round) | Shared dev tooling. Prompt 22. |
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
2. **`Claude Prompts/notes/13-daredevil-notes.md`** — round 2's session: the restructure (with a
   byte-for-byte diff against the original proving nothing but the intended lines changed), Work
   the Crowd placed at the Milestone 1 stunt aftermath, and two Ruthie-continuity prose fixes found
   by grepping a real transcript. Round 1's notes are archived at
   `Claude Prompts/archive/round-1/notes/13-daredevil-notes.md` — the only plot synopsis this game
   has ever had, and the five wiring bugs that made it unfinishable before round 1.
3. `gvb-site-handoff-v9.md` §6 (your restructure's board `href`/`games.mjs` fix, applied) and §10
   (locked decisions #51-53).
4. `assets/js/gvb-save.js` and `assets/js/README.md`. Your adoption is at
   `Projects/daredevil/js/save.js` — unchanged by the restructure.
5. `Projects/daredevil/js/README.md` — new this round, documents why `state.js` is its own file
   (a circular-import trap between `scenes.js` and `engine.js` otherwise) and the content schema,
   the same way `Projects/torchbearer/content-authoring-guide.md` does for that project.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** Fonts vendored in `Projects/daredevil/fonts/`, paths now relative
  (siblings of `index.html`, not a subfolder of it — one substantive markup change the restructure
  made).
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). Yours is `daredevil-save-v1`.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled
  locally instead"** (locked decision #44). `check-integrity.mjs`'s static source sweep is the
  check to trust.
- **A literal `</style>`/`</script>` inside a comment inside that same element silently closes it
  early** — HTML's tokenizer scans for the raw substring regardless of comment syntax. This bit
  Pathfinder Campaigns' own session this round; worth knowing if you ever write a comment about
  "the closing tag" anywhere in this project's markup.

## What is actually here

**`Projects/daredevil_r4.html` is now a redirect stub, not the game.** The real game is
`Projects/daredevil/`, four files: `index.html` (505 lines), `js/state.js` (42 lines — `GS`,
`STAT_LABELS`, `N`/`D`/`C`/`NF`), `js/scenes.js` (4,303 lines, 216.8 KB — the story, as data),
`js/engine.js` (2,113 lines, 109.5 KB — everything else). Total across the four is about 1.2%
bigger than the original single file — the split was done by slicing at confirmed boundaries and
diffing each new file byte-for-byte against the corresponding slice of the original, not
re-typing. Two scene ids were renamed while already touching every line
(`m1_earl_card_stub`→`m1_earl_card`, `m3_end_stub`→`m3_aftermath`) — both finished scenes whose
names no longer described stubs.

**The board points straight at the new path now.** `index.html`'s card `href` is
`Projects/daredevil/`, not the old `daredevil_r4.html`; `games.mjs`'s recipe URL matches. Both
applied by prompt 22 this round. The old URL still resolves via the redirect stub, so nothing that
bookmarked it 404s.

**"Work the Crowd" is placed, not deleted.** 90 finished lines (three crowd moods, an energy meter,
a nerve gate at 45) had no call site through round 1. It now fires on the one Milestone 1 stunt
outcome where Duke is shown actively performing for the crowd (`m1_stunt_perfect`) — the other four
outcomes (shaky, chaos, two crash tiers) go straight to Earl as before, since none of their prose
reads as a crowd-working beat. It's **upside-only**: winning adds +1 Showmanship, losing changes
nothing, the story graph is identical either way. `drive-daredevil.mjs`'s `autopilot()` gained a
branch to answer this minigame's choice-based rounds (a `get correctCall()` getter on the game
object), closing a gap that would have silently broken `smoke-page.mjs`'s "every stunt the autopilot
was asked to land, it landed" assertion the moment this became reachable.

**Two Ruthie-continuity holes are fixed**, found by grepping a real "Ruthie never established"
transcript rather than re-deriving from code: `m5_retire_clean` and `fr4_night_ride` both used to
reference things Ruthie said even on runs where she was never established. Both now branch on
`GS.rels.ruthie`, prose-only, no mechanics change.

**A fourth fix, found while tracing `GS.town` for the restructure**: `patchDynamicScenes()` missed
2 of 5 places a custom hometown gets baked into a scene at load time — including `cold_open_01`,
the very first line of the game. Fixed; all 5 now patched.

**Both test suites still pass, against the new path**: `smoke-save.mjs` (53/53) and `smoke-page.mjs`
(44/44, up from 44 checks but now including a fourth stunt-run result for Work the Crowd).
`transcript.mjs`'s clean (89 scenes) and rough (78 scenes) baselines diffed line-for-line before
and after every change this round — every hunk was an intended change, nothing else moved.

## Your task

Round 2 closed the restructure, Work the Crowd, and the Ruthie holes — the top three items from
the previous round. What's left:

1. **Re-measure gzipped transfer size before deciding whether to split `scenes.js` further into
   fetched chunks** (locked decision #42: measure before deciding an asset is too heavy).
   `scenes.js` alone is 208 KB uncompressed, loaded eagerly by `engine.js`'s import — but 344 KB of
   HTML with no images gzips to much less than the raw number suggests, and nothing this round
   changed that math. Find out what a player's browser actually fetches before treating the size as
   a problem.
2. **A broader absent-relationship prose sweep.** Round 2 checked both existing transcripts for
   every "Ruthie" mention and fixed the two that read wrong. It did not write new transcript plans
   specifically targeting every other absent-relationship combination (no-Cal, no-Pete, no-Earl) to
   hunt for the same class of bug elsewhere. `transcript.mjs` with a plan that skips a different
   relationship each time is the method — it found two real bugs this round using exactly this
   approach on Ruthie alone.
3. **Minigame touch controls at 375px** — verify on an actual touch device or with real
   touch-emulation clicks, not just a read of the event-binding code. Round 2 looked at `bindHold()`
   in `engine.js` while moving it and found it already uses pointer events with `touch-action:none`
   set, which may already work better than round 1's note suggested — but this was not tested on an
   actual touch device, so don't assert it's fixed on code-reading alone.
4. **Contrast measurement.** Still not measured, two rounds running. `--cream-faint` (#7a684c) on
   the dark panels is the one to check first.
5. **Place or delete lower-value cosmetic-adjacent work**: none currently flagged beyond the above.

**The six-way Earl response at the fair remains a design question, not a bug** — five of six
answers lock Ruthie out for the whole game. Round 1 and round 2 both left it as Devon's call, not
something to quietly rebalance.

## Verification

A suite exists in `Projects/daredevil/test/` and protects any further edit:

- `node Projects/daredevil/test/smoke-save.mjs` → **53 passed, 0 failed**.
- `node Projects/daredevil/test/smoke-page.mjs` → **44 passed, 0 failed**.
- **Before any story-logic edit, get fresh baseline transcripts** — `node
  Projects/daredevil/test/transcript.mjs clean` and `... rough` — then diff after, line for line.
  A narrative game that silently loses a branch during an edit gives you no error at all.
- If you touch the save, test the round trip by hand: save mid-story, reload, confirm you are
  where you were. Export, clear storage, import, confirm again. Feed it a corrupt file, confirm
  refusal.
- `grep -c fonts.googleapis.com Projects/daredevil/index.html` → should be 0 (the old file had a
  historical comment; check whether it carried over during the restructure and clean it up if the
  literal hotlink text still appears anywhere).
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken, 0
  collisions across nine widths, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
- `npm run games` doesn't have a regression-beat recipe for this project, only a preview-capture
  one — your own suite above is the regression check. If a future session wants beats added, that's
  a shared-file request into `play-games.mjs`, not something to do yourself.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/13-daredevil-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v*.md` gets
assembled from all twenty-two of them each round.

Use these headings:

```
# Daredevil — session notes

## What it is
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. Carry the plot synopsis forward
from round 1's notes rather than rewriting it from nothing, and update whatever changed (file
paths, mainly, if you touch the structure again).

- **What changed** — files touched and why, in prose, with paths. Old and new paths if you
  renamed anything.
- **What I verified** — actual commands, actual output, and the paths you played. "Should work" is
  not verification.
- **Shared-file requests** — a new board `href` or `games.mjs` recipe change if you restructure
  again, any `gvb-save.js` gap with the exact hook signature. Applicable blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
