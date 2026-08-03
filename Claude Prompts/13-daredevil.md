# 13 — Daredevil

You are working on Daredevil, a narrative game on greyversusblue.com. **Round 3 closed all four of
the previous round's tasks** (gzip measurement, a broader absent-relationship prose sweep, touch
controls verified on a real touch-emulation pass, contrast measured and fixed) **and found the
single biggest open question in the whole game — see "Questions for Devon."** Read
`Claude Prompts/notes/13-daredevil-notes.md` first — it carries the plot synopsis and the full
account of all three rounds' work.

## Questions for Devon

- **What should "Not interested" to Earl actually do?** Choosing it at the county fair correctly
  sets `GS.rels.earl = 'absent'` and removes three optional evening cards (the contract-reading
  card, the FR3 renegotiation, the FR4 Vegas call) — but Milestones 2, 3, and 4 never check that
  flag at all. `goToScene()`'s `_chapter_m2` branch picks its entry scene purely from
  `GS.flags.stuntOutcome`/`hubEveningsUsed`, and the chapter subtitles are fixed strings regardless
  of relationship state, so a player who flatly rejects Earl is still marched through the entire
  investor negotiation, the TV deal, and everything built on it — Earl just "comes back" with no
  acknowledgment he was ever turned down. Round 3 fixed the one line that was flatly false (Duke's
  invented "you said call when I was ready" callback in `m2_entry_waited`, replaced with dialogue
  consistent with the rejection) but built no real alternate content for this branch — that's a
  content-authoring decision, not a bug fix. Should "Not interested" stay as "Earl doesn't take no
  for an answer" (maybe with one more acknowledgment line at M3/M4), or does the rejection deserve a
  genuinely smaller, backer-less version of the middle game? This is the highest-value open item by
  a wide margin — bigger than anything flagged in round 1 or 2.

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
2. **`Claude Prompts/notes/13-daredevil-notes.md`** — round 3's session: the gzip measurement, a
   real absent-relationship prose sweep (Earl and Pete this time, via
   `test/transcripts/no_earl.md`/`no_pete.md`), touch controls verified with a real
   touch-emulation pass (`test/verify-touch-375.mjs`, new, one-off), the `--cream-faint` contrast
   fix, and the Earl/"Not interested" finding above. Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/13-daredevil-notes.md` — the restructure (with a
   byte-for-byte diff against the original proving nothing but the intended lines changed), Work
   the Crowd placed at the Milestone 1 stunt aftermath, and two Ruthie-continuity prose fixes.
   Round 1's are at `Claude Prompts/archive/round-1/notes/13-daredevil-notes.md` — the only plot
   synopsis this game has ever had, and the five wiring bugs that made it unfinishable before
   round 1.
3. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58).
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

**Both test suites still pass**: `smoke-save.mjs` (53/53) and `smoke-page.mjs` (44/44, including
the Work the Crowd stunt-run result). `transcript.mjs`'s clean (89 scenes) and rough (78 scenes)
baselines diffed line-for-line before and after every change this round — every hunk was an
intended change, nothing else moved.

**Two absent-relationship prose sweeps found and fixed one real bug, round 3.** New transcript
plans, `test/transcripts/no_earl.md` and `no_pete.md`, extend round 2's Ruthie-only method to two
more relationships. Found: `m2_entry_waited` had Duke reference a call-back promise Earl never
actually made on a no-Ruthie-established run where Earl was also the one waiting — a factually
false line, now branching correctly on `GS.rels.earl === 'absent'`.

**Touch controls verified for real, round 3** — not just a code read. `test/verify-touch-375.mjs`
(new, a one-off, not part of the committed regression suite) drives the Stunt Run minigame's pedal
with Playwright touch-emulated pointer events at 375px. Confirmed working: `bindHold()`'s pointer
events with `touch-action:none` hold up under real touch emulation, not just in theory.

**Contrast is fixed, round 3.** `--cream-faint` is `#ac9a7f` now (was the too-dark `#7a684c`),
applied consistently across all 14 CSS rules that reference it.

**A real repo-wide bug was found here and reported, not fixed locally.** `sync-social-tags.mjs`
reported permanent DRIFT on this project's `index.html` even though its `og:url`/`og:image` content
was already correct — root-caused and fixed by prompt 22 this round (a Windows/`autocrlf`
line-ending mismatch, `gvb-site-handoff-v10.md` §3), not a bug in this project's own file.

## Your task

Round 3 closed all four of the previous round's tasks and found the Earl/"Not interested" gap
(see "Questions for Devon"). What's left:

1. **Once Devon answers the Earl question, build whichever shape was chosen** — an acknowledgment
   line or two at M3/M4, or a genuinely smaller backer-less middle game. This is the highest-value
   work on this project by a wide margin.
2. **A Danny/Tommy absent-relationship sweep**, extending the same method (round 2: Ruthie; round
   3: Earl, Pete) to the two remaining tracked relationships. Found one real bug per relationship
   pass so far — worth continuing the pattern.
3. **A physical touch-device pass**, if one becomes available. Round 3's touch-emulation pass is
   real evidence, but it's still emulation, not a physical device.
4. **Place or delete lower-value cosmetic-adjacent work**: none currently flagged beyond the above.

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
- `grep -c fonts.googleapis.com Projects/daredevil/index.html` → should be 0 (only a historical
  comment documenting the removal, never a live reference).
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken, 0
  collisions across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round as
  files are added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round; the
  false-DRIFT this project reported is fixed at the root, see above).
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
