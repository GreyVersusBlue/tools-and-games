# 13 — Daredevil

You are working on Daredevil, a narrative game on greyversusblue.com. At 6,888 lines and about
347.6 KB it is still **the largest single-file project in the repo**. Round 1 made it completable
for the first time in its history — see "What is actually here" below — and gave it a save,
vendored fonts, a preview, and a test suite. This prompt is no longer the only record of this
game: read `Claude Prompts/notes/13-daredevil-notes.md` first, it carries the plot synopsis and
the full account of what round 1 found.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/daredevil_r4.html` (6,888 lines, 347.6 KB)
- `Projects/daredevil/` — round 1 created this folder for the save module (`js/save.js`), the
  vendored fonts, and the test suite (`test/`). It's yours; extend it freely, including the
  restructure into `Projects/daredevil/index.html` the task list below asks for.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this same
repo right now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 21. This game has both now — `daredevil.jpg` in each, applied by prompt 21 this round. |
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
2. `Claude Prompts/notes/13-daredevil-notes.md` — round 1's session notes for this exact project,
   the largest single find of the round. It has the only plot synopsis this game has ever had
   written down, plus the full account of the five wiring bugs that kept the game from being
   finished by anyone and how each was fixed. Read it before you touch the file.
   `Claude Prompts/archive/` holds every earlier round's prompts and notes, if you need to go back
   further than that.
3. `gvb-site-handoff-v8.md`, all of it. §9 for locked decisions 43 through 50, especially #44 (the
   `page.__blocked` vs `page.__shimmed` distinction — this project's own round-1 notes flagged the
   exact measurement hole it fixes). §2 is the correction to v7 §5's "zero offsite requests
   site-wide" claim; cite §2, not v7 §5, when that claim comes up.
4. `assets/js/gvb-save.js` and `assets/js/README.md`. You already have a working adoption at
   `Projects/daredevil/js/save.js` — read it alongside the module before changing either.
5. `Projects/torchbearer/content-authoring-guide.md` — the same-repo precedent for a content
   format with an authoring contract, relevant to the restructure task below. (This path moved
   this round; it used to be `Projects/Torchbearer files/content-authoring-guide.md`.)

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** You have three font hotlinks — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). You currently have none. Whatever you
  pick, that is the name it keeps forever.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled
  locally instead"** (locked decision #44). An empty `__blocked` no longer proves a page is clean —
  `check-integrity.mjs`'s static source sweep is the check that scales past what a browser suite
  happens to drive, and it's what this project's own round-1 notes asked for.

## What is actually here

6,888 lines, about 347.6 KB, in `Projects/daredevil_r4.html`, plus a `Projects/daredevil/` folder
holding the save module, the vendored fonts, and the test suite. Title still just "DAREDEVIL."
Tagged `Narrative` on the board, sealed with the flame glyph. Preview and OG image both exist now
(`assets/previews/daredevil.jpg`, `assets/og/daredevil.jpg`), applied by prompt 21 this round.

**This is now a completable, tested game, all eight endings reachable — it was not before.**
Before round 1 the game could not be finished by anyone, by any route, ever: every run stopped at
the same place, the Milestone 3 pre-stunt choice, about 60% of the way through. Five independent,
completely silent wiring bugs caused it: every free-roam hub gated its milestone button on an
evening counter that couldn't reach zero on most paths; a minigame id (`_minigame_stunt_m3`) was
referenced by four choices and answered by nothing; two hub cards were gated on flags their own
scenes never set (one looped forever, one hid six finished scenes); `GS.rels.pete` was read in
five places and assigned in none, which silently deleted the "mentor the apprentice" ending from
the choice list for the game's entire history; and three of four stunt-result handlers read
`res.outcome` instead of the real field, `res.result`, routing every stunt from Milestone 3 on to
its failure branch regardless of how well it was ridden. **All five are fixed.** 73 scenes, 88.1
KB, 42% of the scene database, were unreachable before this round and are reachable now, and the
eighth ending now appears. Full account and the plot synopsis: `Claude Prompts/notes/13-daredevil-notes.md`.

**It has a save.** `Projects/daredevil/js/save.js`, an ES module on `assets/js/gvb-save.js`. Key
**`daredevil-save-v1`** (locked decision #36 — it does not change). The save bar is on the hub, not
just the title screen; the title screen has import and a Continue button. `gvb-save.js` itself
picked up five backward-compatible fixes this round from other adopters — construction no longer
throws in a storage-blocking browser, `load()`'s `getItem` call is guarded, `fresh(...args)` /
`reset(...args)` forward arguments to a `defaults` factory, there's a new `clear()`, and
`mountSaveBar` gained `filename`/`labels` options. None of these were this project's own request;
they're just available now if useful.

**Zero offsite requests.** Seven fonts vendored into `Projects/daredevil/fonts/` (100.3 KB: Alfa
Slab One 400, Oswald 400/500/600/700, Space Mono 400/700). `grep -c fonts.googleapis.com
Projects/daredevil_r4.html` returns 1, but read the line before trusting the count: it's a comment
recording the history of the fix, not a live hotlink. `check-integrity.mjs`'s static offsite sweep
(locked decision #44, new this round) is the check to trust now instead of a hand grep or
`page.__blocked` — it's what closed the exact measurement hole this project's own round-1 notes
flagged (v7 §5's "zero offsite requests site-wide" claim was wrong; the correction is
`gvb-site-handoff-v8.md` §2, cite that instead of v7 §5 from here on).

**A test suite exists, in `Projects/daredevil/test/`, which this project owns:**
`smoke-save.mjs` (53 assertions, no browser), `smoke-page.mjs` (44 assertions, real browser —
route-coverage checking and a loop detector included), `drive-daredevil.mjs` (the driver,
including an `autopilot()` that can win the stunt minigame from telemetry), and `transcript.mjs`
(plays a full run and writes every line and choice offered to `test/transcripts/`). Both suites
still pass fresh: 53/53 and 44/44.

**The ending screen no longer says "END OF BUILD."** It reads "THE END" / "A Life on Two Wheels."

**The `_r4` in the filename is still there, and the URL hasn't moved.** Round 1 deliberately left
the restructure for later, on the reasoning that a 6,700-line branching narrative shouldn't be
refactored until there's a test suite that can prove nothing broke — see the task list below. So
`Projects/daredevil_r4.html` is still the board's `href` and no shared-file request is outstanding
for it.

## Your task

There is no handoff backlog for this game. **Nothing in eight sessions of handoffs mentions it at
all**, which given it is the largest single file in the repo is itself the finding: 344 KB of work
that nobody has looked at, verified, or written down.

**So the first job is genuinely to find out what this is.** Play it. Not skim the code — play it,
to an ending, and then start again and take a different branch. Then write down what it is: the
premise, roughly how long a run takes, how many endings, whether the branches reconverge or stay
split. That description does not currently exist anywhere and it is the most useful thing you can
produce.

**Then plan, then build the top items.** Write a prioritized plan into your notes, ordered by
value per effort, with tradeoffs named. Then implement the highest value-per-effort items in this
same session and verify them. Don't stop at the plan.

The things most likely to top that list:

- **Give it a save.** Adopt `assets/js/gvb-save.js` rather than hand-rolling — you get
  `localStorage` persistence, file export and import so a run survives a cleared browser, a
  memory-backed fallback for browsers configured to block storage (reading the `localStorage`
  property *throws outright* in that case, which is the trap a naive `try/catch` around `setItem`
  misses entirely), and validation so a corrupt blob is refused rather than `JSON.parse`d
  straight into game state. Specifics from v7 §1 and §2:
  - **Pick the key once and keep it forever** (locked decision #36). Something like
    `daredevil-save-v1`.
  - **`defaults` may be a factory.** If a new run randomises anything, pass a function — passing a
    literal is how `slot.reset()` ends up handing back `null`, which is the gap The Fourth
    Quarter's three random job applicants found.
  - **Fill-ins go in `repair`, not `migrate`** (locked decision #37): `repair` runs on **every**
    accepted load from every door, `migrate` only on version drift. You have no legacy saves yet,
    which makes this the one chance to get the shape right before you do.
  - **For a branching narrative, think about what the save actually holds.** A node id plus a flag
    set is small and survives a rewrite of the prose; a serialised engine state does not. If you
    want to keep editing the story after players have saves, the save must not embed the story.
    That is the real design decision in this task and it is worth getting right the first time.
  - **`mountSaveBar` takes a `buttons` option** and each button carries
    `data-gvb="export|import|reset"`. **Put it somewhere reachable during play** — v7 §9 has an
    item open specifically because The Fourth Quarter's is only on its start screen.
  - **Import relatively** — `../assets/js/gvb-save.js` — so any Node test can resolve it.
  - **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`.
- **Vendor the three fonts.** Alfa Slab One, Oswald, Space Mono. Local `@font-face`, woff2 in a
  folder you own, hotlinks deleted, only the weights the page actually uses. README naming source
  and licence, the way `Projects/golden-hour-beach/assets/textures/` does. Measure the total and
  report it (locked decision #42).
- **6,683 lines in one file is past the point where this is defensible.** This is the strongest
  restructure candidate in the repo. For a narrative game the natural split is
  `Projects/daredevil/index.html` plus `js/` for the engine, `css/`, and — the important part —
  **the story content as data rather than code.** If the prose currently lives in JS string
  literals interleaved with logic, separating them is what makes the story editable without
  risking the engine, and it is what makes a save that stores a node id possible at all.
  `Projects/Torchbearer files/content-authoring-guide.md` is a same-repo precedent for a content
  format with an authoring contract; read it.
  **The URL cost:** `/Projects/daredevil_r4.html` stops resolving. That is a Shared-file request
  for the board `href`, and say plainly in your notes that the old URL breaks. This is also the
  moment to drop the `_r4`.
- **344 KB is a lot to send a visitor.** Find out how much of it is prose, how much is engine, and
  how much is dead. If the whole story ships on first paint, splitting content into fetched
  chunks is a real win — but **measure first** (locked decision #42, which exists because a size
  estimate wrong by 4× blocked a good decision for two sessions). Numbers, not impressions.
- **No preview and no OG card.** Getting one means a recipe in `Tools/board-check/games.mjs` and a
  run of `npm run previews`, both prompt 21's. Request it if you think it deserves one and say
  what the frame should show. Locked decision #28: a preview is a frame from *play* and the
  capture has to prove it got there. Locked decision #29: a turn-based game legitimately gets
  `live: false`; don't animate something just to satisfy a motion check.
- **Mobile.** 375×812. A narrative game is the best mobile candidate on the site. Check whether it
  works, because if it does that is worth knowing and if it doesn't it is worth fixing.
- **Accessibility.** Heading order, contrast, keyboard navigation, whether choices are reachable
  without a mouse, and whether the text reads sensibly to a screen reader. Narrative games have
  the least excuse for getting this wrong.

## Verification

This game has no test suite. At 6,683 lines, if you restructure it, it needs one — put it in a
folder you own and make it exit non-zero on failure (locked decision #13).

- **Play it to an ending before you change anything.** Then play a different branch. Write down
  what you did, because that is your regression baseline and nothing else exists.
- If you restructure, **replay the same two paths afterwards and compare.** A narrative game that
  silently loses a branch during a refactor gives you no error at all — the choice just isn't
  there any more. Nothing will catch that but a human playing it.
- Once a save exists, test the round trip by hand: save mid-story, reload, confirm you are where
  you were. Then export, clear storage, import, confirm again. Then feed it a corrupt file and
  confirm it is refused.
- After vendoring, grep the file for `fonts.googleapis.com` → zero hits. `page.__blocked` is
  **not** the check; `prepPage()` fulfills those requests.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you
  finish, especially if you renamed anything.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited
  inside the `gvb:social` markers.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/13-daredevil-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

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

Note the extra first heading, which only this prompt asks for. **Nothing in eight sessions of
handoffs describes this game.** Write that description: premise, run length, number of endings,
branch structure, and what state the writing is in. Whatever else you get done, that section is
the thing this session is for.

- **What changed** — files touched and why, in prose, with paths. Old and new paths if you renamed.
  Vendored font total in KB. Byte counts if you split the content out.
- **What I verified** — actual commands, actual output, and the paths you played. "Should work" is
  not verification.
- **Shared-file requests** — a new board `href` if you restructured, a preview recipe if you want
  one, any `gvb-save.js` gap with the exact hook signature. Applicable blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. For a 344 KB file you have never seen before, this section will be long, and that is
  correct.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
