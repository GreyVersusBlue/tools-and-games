# 22 — General Site Improvements

You own the shared infrastructure of greyversusblue.com: the board, the 404 page, the shared save
module, the dev tooling, and the handoff. **Twenty-one other Claude sessions are working on individual
projects in parallel and none of them may touch any of it** — instead each one writes what it needs
into a notes file, and applying those is your job.

**Round 3 ran a single, full pass** — all twenty-one other project notes files existed by the time
this thread ran, confirmed by listing `Claude Prompts/notes/` before touching anything shared, so
tasks one and two both ran without a partial-pass gate. It root-caused and fixed a repo-wide
`sync-social-tags.mjs` false-DRIFT that sixteen of twenty-one projects independently reported (a
Windows/`core.autocrlf` line-ending mismatch), fixed two real bugs in shared test tooling that a
fair (real Chrome/Playwright) environment finally let it prove (Golden Hour's wading beat, The
Fourth Quarter's Real Estate walk), extended `check-integrity.mjs`'s offsite sweep to `.js`/`.css`,
gave Orbital its first preview and OG card, applied every shared-file request, and wrote
`gvb-site-handoff-v10.md` (site version now **11**). Read the sequencing section before you
start — it's the same shape every round.

## Your boundary

You own these paths:

- `index.html` — the board. The single most contested file in the repo.
- `404.html`
- `newindex.html` — appeared at the repo root, committed directly by Devon rather than through any
  of the twenty-two prompts. It's a Town Services landing page, linked from a board notice. Treat it
  as yours by default — its fonts are vendored into `assets/fonts/` now (locked decision #51).
- `assets/js/gvb-save.js` and `assets/js/gvb-save.test.mjs` — the shared save module
- `assets/js/README.md`
- `assets/fonts/**` — the site's own vendored fonts (`index.html`/`404.html`/`newindex.html`).
- `assets/previews/**`, `assets/og/**`, and their READMEs — generated artifacts
- `Tools/board-check/**` — **except `play-castle.mjs` (prompt 05's) and any project's own
  test folder** (e.g. `Projects/integer-foundry/test/browser.mjs`, `Tools/name-picker/test/`,
  `Tools/seating-chart/test/`). Those are the owning project's files even though they drive a
  browser the same way your tooling does.
- `CNAME` — still absent. Leave it absent unless Devon says otherwise.
- `gvb-site-handoff-v11.md` — **which you write this round.** v1 through v10 are history; read
  them, never edit them.
- `Claude Prompts/notes/**` — you read all twenty-two. You write none of them except your own.

**Everything else is read-only to you.** Every project under `Projects/`, `Pathfinder/` and `Tools/`
belongs to one of the other twenty-one prompts. If a project needs an internal fix, **it is not yours to
make** — note it in the handoff as backlog for that project's next session.

**`Tools/` is capitalized on purpose** (locked decision #14).

## Sequencing — read this before you start

**Do now, independent of everyone else:**

- Read every notes file that exists so far, and read `gvb-site-handoff-v10.md` fresh even though
  you may be the thread that wrote a previous one — you're not the same session.
- Check for any project whose preview/OG/regression-suite entry is blocked on a single missing
  artifact, the way Torchbearer's was for two rounds and Castle Conundrum's recapture was blocked
  on a fair environment before round 3. If that blocker is now resolved per that project's own
  notes, this is transcription; if not, leave it.

**Do only after the other twenty-one threads have finished and their notes files exist:**

- Task one: apply every shared-file request.
- Task two: bump the version line and write `gvb-site-handoff-v11.md`.

If you are running before the others are done, do the independent check above, then stop and say
clearly in your notes that tasks one and two are outstanding and need a second pass. **Do not write
`gvb-site-handoff-v11.md` from an incomplete set of notes files** — a handoff that claims to
summarise twenty-two sessions but saw fewer is worse than no handoff, because the next session will
trust it.

## Questions for Devon

- **The Name Picker rename (`Tools/Name Picker.html` → `name-picker.html`) is a structural deadlock
  now, raised three rounds running.** The board's Town Services section no longer links to that
  file directly — it links to `newindex.html` (your file), which itself holds the real
  `href="Tools/Name%20Picker.html"` link. So the same-commit change a rename needs is one line in
  `newindex.html` plus the file rename itself — and no single prompt owns both halves (the file is
  prompt 18's, the link is yours). Should you be authorized to do the rename yourself this once
  (touching a file that's normally prompt 18's), should prompt 18 be authorized to touch
  `newindex.html`'s one line, or is "leave it forever" the actual answer? Prompt 18's own prompt
  file carries the matching question — resolve both together if you resolve either.

## A cross-cutting bug class, closed this round — confirm before assuming it could recur

Round 2 found a `page.waitForFunction(fn, null, opts)` incompatibility (Playwright's argument
shape, wrong under this environment's `puppeteer-core`) in every file under `Tools/board-check/**`
you own, plus at least three project-owned test files outside your boundary. As of this round,
every known instance is fixed — confirmed by direct read, not just trusted from notes:
`play-castle.mjs` (prompt 05), `Projects/integer-foundry/test/browser.mjs` (prompt 14),
`Tools/name-picker/test/browser.mjs` (prompt 18), and `Tools/seating-chart/test/drive-seating.mjs`
(prompt 20, which had a *third*, previously unflagged instance — `page.addInitScript()`). If a
future round's thread reports a new instance in yet another project's test file, that's worth a
mention in the handoff as a recurring pattern (every project that wrote its own browser-driven test
folder by copying an early, Playwright-only-era call shape), not a surprise.

## Two real bugs fixed this round, found because a fair environment let them prove out

Two beats that a previous round's fair-environment (real Chrome/Playwright) re-run left as "fails,
and not the project's fault" got fixed at the root this round, both in shared tooling:

- **Golden Hour's wading beat** (`play-games.mjs`) needed an explicit re-aim before its `KeyW`
  hold. Two prior look-tests leave the camera facing an arbitrary direction, and the obvious fix
  (`lookAt()`) silently no-ops once pointer lock is released — which the test just above the
  wading one releases on purpose, to prove the keyboard-only path works. **Fix:** poll
  `camState().facing` toward 0 using arrow keys instead (locked decision #54).
- **The Fourth Quarter's Real Estate walk-to-station beat** needed `walkTo()`'s raw
  `camera.rotation.set()` write (`aimAt()`) replaced with a `lookAt`-style steering option for
  games that hand-roll their own camera instead of using `PointerLockControls` — this project's
  own per-frame `yaw`/`pitch` overwrite erased the raw write within ~16ms. **Fix:** `walkTo()` now
  takes `{steer:'lookAt', sens}` (locked decisions #55, #56). A second, unrelated issue compounded
  this one: a dev-menu shortcut used earlier in the same test released pointer lock and never
  reacquired it, so `lookAt()`'s dispatched mousemove was, again, silently ignored — fixed with a
  canvas re-click before the walk.

Both confirmed twice, deterministic both times, on a fair environment. **Pattern worth naming**:
before assuming a `lookAt()`/`walkTo()` steering fix is wrong, check whether pointer lock is
actually held at that point in the test (locked decision #56) — both bugs above looked at first
like a wrong angle or a wrong steering function, and were actually "something upstream in the same
test released pointer lock for an unrelated reason." Locked decision #53 (this environment's own
Linux/software-rendered Chromium being slow and inconsistent for three.js movement) still applies
independently of both fixes above — a clean run on a fair environment doesn't guarantee a clean run
on this sandbox, and vice versa.

## The repo-wide `sync-social-tags.mjs` false-DRIFT, root-caused and fixed this round

Sixteen of twenty-one projects independently reported the same `npm run social:check` result this
round: several pages "out of date" even though their content was byte-for-byte correct. Root
cause: `blockFor()` always joined the generated `gvb:social` block with a bare `\n`; on a Windows
checkout with `core.autocrlf=true`, every LF this script has ever written gets rewritten to `\r\n`
at checkout — including the block itself — so the comparison showed permanent drift on content
that was otherwise identical. **Fixed**: `blockFor()` takes an `eol` parameter now; the call site
detects the target file's actual line ending and matches it (locked decision #57). Verified per
locked decision #34: converted a committed page to all-CRLF by hand, confirmed `--check` still
reported it current, restored the file. If a future round reports this exact symptom again, it's a
regression in this fix, not a new instance of the old bug.

## `check-integrity.mjs`'s offsite sweep now covers `.js`/`.mjs`/`.css`, not just `.html`

Schedule Visualizer's round-2 request: its own 590 KB of `.js` / 156 KB of `.css` (now split across
`Tools/schedule/app/`) had zero coverage. Extended the same resource-shaped-regex pattern to
`.js`/`.mjs`/`.css` (locked decision #58); `/libs/` joined the `SKIP` list for vendored bundles.
**Found and fixed in passing**: the pre-existing `SKIP` list never actually matched anything on
this machine (Windows `path.join` returns backslashes; the list's own patterns are lowercase
forward-slash) — normalized the comparison, which fixes the original three.js-package exclusion
too, not just the new one.

## The "Questions for Devon" convention — check each project's own prompt file, not just this one

Project prompts carry their own labeled "Questions for Devon" blocks near the top, the durable home
for genuine open decisions — not just prose in this handoff. **When you write
`gvb-site-handoff-v11.md`, check each project's own prompt file for one of these blocks before
summarizing that project's open decisions** — that block is the source of truth, not this file's
memory of it. If Devon answers one directly this round, that's prompt 23's job to remove and
record durably next refresh, not yours to edit in a project's file — just make sure the handoff
records the answer clearly.

**`Pathfinder/data/`** (prompt 01's block) and **the Name Picker rename** (prompt 18's block, and
yours, above) are the two currently open. If `Pathfinder/data/` is raised again this round, that's
a seventh time — worth a direct one-line ask in the handoff rather than carrying it forward again.

## Required reading

1. This whole file.
2. `Claude Prompts/README.md` — how the twenty-two-way split works and which prompt owns what.
3. **Your own notes file from last round, `Claude Prompts/notes/22-general-site-improvements-notes.md`.**
   It records exactly what round 3 applied and refused, request by request. The archived copies
   under `Claude Prompts/archive/round-1/`, `round-2/`, and `round-3/` hold everything from before
   that.
4. `gvb-site-handoff-v10.md`, all of it, then §10's locked-decision list (through #58) plus the
   earlier lists it cites.
5. `Tools/board-check/README.md`, then `harness.mjs`, `drive.mjs` (`waitFor`/`wait`/`textContent`
   helpers, plus the new `{steer:'lookAt'}` option on `walkTo()`), `sync-social-tags.mjs` (the
   `eol`-aware `blockFor()`), `check-integrity.mjs` (the `.js`/`.css` sweep), `capture-previews.mjs`,
   `games.mjs`, `tools.mjs`.
6. `assets/js/gvb-save.js` and its test, in full.
7. Every `Claude Prompts/notes/*.md` file that exists when you start, including the two now living in
   `Claude Prompts/Stable/` (01 and 15) if either has a note worth reading.

## House rules

- **No build step.** Static files served by GitHub Pages from the repo root at `greyversusblue.com`.
- **The ledger rail is generated from the DOM, never hand-authored** (locked decision #6).
- **Seal glyphs are per project; ribbon tags are per genre** (locked decision #5).
- **`404.html` links are root-absolute** (locked decision #8).
- **`#quest-board .notice { padding-top: 2.15rem }` is load-bearing** (locked decision #10).
- **Never hand-edit inside the `gvb:social` markers in any page** (locked decision #31).
- **The favicon is one shared inline SVG data-URI on every page** (locked decision #32).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Measure before deciding an asset is too heavy** (locked decision #42).
- **Windows is the dev machine** (v7 §7, v6 §5).
- **`assets/fonts/` is for the site itself, not a project — and this now includes any file that's
  board-adjacent, not just `index.html`/`404.html`** (locked decisions #43, #51). `newindex.html`
  joined it this round. Still not a precedent for a project's own shared-font request; that's #17's
  territory.
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled
  locally instead"** (locked decision #44).
- **Faire Weekend: a day is final once the gates close** (locked decision #45).
- **A tool's own version lives in the page, not the filename** (locked decision #46).
- **`gvb-save.js`'s `fresh`/`reset` forward arguments to a `defaults` factory, and `clear()` erases
  without invoking one** (locked decision #47).
- **`gvb-save.js`'s `mountSaveBar` takes `filename` and `labels` overrides** (locked decision #48).
- **Two storage-construction gaps in `gvb-save.js` are fixed** (locked decision #49).
- **`repair` also covers content drift, not just schema drift** (locked decision #50).
- **`assets/fonts/` extends to any site-adjacent file, not just `index.html`/`404.html`** (locked
  decision #51, see above).
- **`Tools/board-check/package-lock.json` is tracked; `node_modules/` stays ignored** (locked decision
  #52). An unpinned lockfile is exactly how the `waitForFunction` bug went unnoticed for a whole round
  — a dependency version drift now shows up as a reviewable diff.
- **A real-time movement or physics assertion failing under this environment's Linux/software-
  rendered Chromium is inconclusive, not confirmed** (locked decision #53).
- **`play-games.mjs`'s Golden Hour wading beat re-aims via arrow keys, not `lookAt()`, before its
  `KeyW` hold** (locked decision #54). See above.
- **`drive.mjs`'s `walkTo()` takes a `{steer:'lookAt', sens}` option for games with a hand-rolled
  camera** (locked decision #55). See above.
- **Check whether pointer lock is actually held before assuming a steering fix is wrong** (locked
  decision #56). See above.
- **`sync-social-tags.mjs`'s generated block matches the target file's own line-ending convention**
  (locked decision #57). See above.
- **`check-integrity.mjs`'s offsite sweep covers `.js`/`.mjs`/`.css`, and `SKIP` matching is
  case/separator-normalized** (locked decision #58). See above.

## Task one: apply every Shared-file request (after the other twenty-one finish)

Read all twenty-one notes files (plus the ones now living in `Claude Prompts/Stable/` if any carry
a request). Each has a **Shared-file requests** section written to be applied without reading that
session. What to expect, based on what previous rounds taught:

- **Board card rewordings and `href` changes**, especially from any thread that restructured a
  single-file project into a folder. Verify a restructure actually needs a board edit before assuming
  it does — several threads found ways to restructure without touching the URL.
- **Requests for new `gvb-save.js` hooks.** **Reconcile before you implement** if two threads
  independently ask for the same shape of thing.
- **Regression-suite changes to `play-games.mjs` or `games.mjs`.** Apply the spirit of the request,
  adapt where the actual code doesn't match the sketch, and say so in your notes.
- **New preview/OG requests, or recapture requests.** Check locked decision #53 above before
  attempting one for a three.js game — a recapture that can't complete here isn't a code problem.
- **The Name Picker rename** (see "Questions for Devon" above) — only act if Devon has actually
  authorized crossing the boundary; otherwise it stays a standing, low-urgency suggestion.

When you touch `gvb-save.js`, `node assets/js/gvb-save.test.mjs` must still pass — currently
**50 passed, 0 failed**. Every project that imports it must still work — run their suites, don't
just trust the module's own test. Current adopter list (eleven projects): The Fourth Quarter,
Aphelion, Torchbearer, The Absalom Inheritance, Daredevil, Integer Foundry, The Fracture Cycle,
Name Picker, Closing Time, Corner & Kettle, Seating Chart Generator.

## Task two: version line and handoff (after task one)

- **Bump the version line** in `index.html` from `version 11` to `version 12`.
- **Write `gvb-site-handoff-v11.md`**, assembled from all twenty-two notes files plus your own work.
  Follow the shape of v10: a one-paragraph summary, numbered sections, a backlog-state table, a
  "things I found and deliberately did not fix" section, a locked-decisions section carrying the
  previous fifty-eight forward and numbering new ones from 59, a suggested-next-session list, and a
  "Verified this session" list.

Things that should end up in it, if the round bears them out:

- Any answer to the `Pathfinder/data/` or Name Picker rename questions, if Devon weighed in.
- Any new locked decisions from 59 onward.
- **A note on the "Questions for Devon" convention** (see above) — which project prompts carry one,
  and whether any got answered and should be marked resolved for prompt 23's next refresh.
- Any project your own read suggests is a `Stable/` candidate, or a `Stable/` project that should
  move back — note it for prompt 23, since moving prompt files isn't your boundary.

## Verification

- `cd Tools/board-check && npm run check` → currently **559 units, 0 broken, 0 collisions across nine
  widths, tightest vertical gap 9.1px** (moves every round as files are added elsewhere in the repo;
  0 broken is what matters).
- `npm run social:check` → currently **18 notices, 18 already current, 0 out of date, 0 failed**
  (Orbital's card joined this round).
- `node assets/js/gvb-save.test.mjs` → currently **50 passed, 0 failed**.
- `npm run tools` → currently **18 checks, 0 failed**.
- `npm run games` → as of this refresh, three independent full runs on a fair (real Chrome/Playwright)
  environment all reported **146 checks, 0 failed**, identical every time — the first fully clean
  pass this handoff has ever reported. On this Linux sandbox specifically, still expect run-to-run
  variance per locked decision #53 — that decision is about this environment's rendering, not about
  the suite itself.
- `npm run previews` → confirm whichever games you touched still reach gameplay, with the caveat
  above for three.js games specifically.
- Every project suite whose files you touched through a shared-file request.
- **Confirm zero live offsite requests, repo-wide**, as a final check before writing the handoff.
- **Locked decision #34**, on anything you touch in `gvb-save.js` or `check-integrity.mjs`.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window nobody is looking at (v7 §6). Other threads may be running
these suites; only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/22-general-site-improvements-notes.md` **as well as**
`gvb-site-handoff-v11.md`. The notes file records what you did; the handoff records what the whole
batch did.

Use these headings:

```
# General Site Improvements — session notes

## What changed
## What I verified
## Requests applied, and requests refused
## Deliberately not done
## Next session
```

**List every request from every notes file and say what happened to it.** A request you declined is
fine and often correct, but a request that silently vanished leaves a project thread believing
something shipped that didn't.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Sections are allowed to be opinionated and to
say "I looked at this and left it, here's why". Match that — **you are writing the next one, so this
matters more for you than for anyone else in the batch.** Do not write "comprehensive" or "robust"
anywhere.
