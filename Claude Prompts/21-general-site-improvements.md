# 21 — General Site Improvements

You own the shared infrastructure of greyversusblue.com: the board, the 404 page, the shared save
module, the dev tooling, and the handoff. **Twenty other Claude sessions are working on individual
projects in parallel and none of them may touch any of it** — instead each one writes what it needs
into a notes file, and applying those is your job.

**Round 2 ran twice.** A first pass correctly stopped after only nine of twenty project notes files
existed, rather than write a handoff from an incomplete set. A second, full pass — once all twenty
existed — fixed a live site-wide breakage Devon introduced outside the prompt process, fixed a
`puppeteer-core` incompatibility that had broken `npm run games` for every game all round, applied
every shared-file request, and wrote `gvb-site-handoff-v9.md` (site version now **10**). Read the
sequencing section before you start — it's the same shape every round, and this round is proof the
"don't write the handoff early" rule matters.

**A 22nd project landed on `main` after this refresh's own survey ran, and nothing in `Claude
Prompts/` owns it yet.** `Projects/orbital/` ("Orbital," a gravity flight-plan puzzle game) merged
via PR #6 (commit `6661745`), adding a board notice (`index.html` gained 9 lines) and its own
fonts/JS. `npm run social:check` now reports **18 notices**, not 17 — genuinely current as of this
note, expected to move again once Orbital gets a real social-tag pass (`npm run social:check`
currently shows it "had no block," meaning it's linked from the board but has no generated
`gvb:social` head block yet). No prompt file exists for it, and no boundary table row does either.
**This is the first thing whoever runs this prompt next should account for**: either give it its own
prompt (22 becomes 23, following this file's own numbering conventions) or fold it in as a stopgap,
but don't silently treat 17-notices/twenty-project figures anywhere in this refresh as still
current — they were accurate when this refresh's survey ran, and this landed afterward, the same
class of thing §1-2 below describe happening mid-round-1.

## Your boundary

You own these paths:

- `index.html` — the board. The single most contested file in the repo.
- `404.html`
- `newindex.html` — appeared at the repo root, committed directly by Devon rather than through any
  of the twenty-one prompts. It's a Town Services landing page, linked from a board notice. Treat it
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
- `gvb-site-handoff-v10.md` — **which you write this round.** v1 through v9 are history; read them,
  never edit them.
- `Claude Prompts/notes/**` — you read all twenty-one. You write none of them except your own.

**Everything else is read-only to you.** Every project under `Projects/`, `Pathfinder/` and `Tools/`
belongs to one of the other twenty prompts. If a project needs an internal fix, **it is not yours to
make** — note it in the handoff as backlog for that project's next session.

**`Tools/` is capitalized on purpose** (locked decision #14).

## Sequencing — read this before you start

**Do now, independent of everyone else:**

- Read every notes file that exists so far, and read `gvb-site-handoff-v9.md` fresh even though
  you're the thread that wrote it last round — you're not the same session.
- Check for any project whose preview/OG/regression-suite entry is blocked on a single missing
  artifact (a save fixture, a committed file) the way Torchbearer's was for two rounds. If that
  artifact now exists, this is transcription per that project's own notes; if not, leave it.

**Do only after the other twenty threads have finished and their notes files exist:**

- Task one: apply every shared-file request.
- Task two: bump the version line and write `gvb-site-handoff-v10.md`.

If you are running before the others are done, do the independent check above, then stop and say
clearly in your notes that tasks one and two are outstanding and need a second pass. **Do not write
`gvb-site-handoff-v10.md` from an incomplete set of notes files** — a handoff that claims to
summarise twenty-one sessions but saw nine is worse than no handoff, because the next session will
trust it. This happened exactly this way last round and the first pass's own notes record why it
correctly stopped rather than push through.

## A cross-cutting bug class that turned out bigger than first thought — check for more of it

Round 2 fixed a `page.waitForFunction(fn, null, opts)` incompatibility (Playwright's argument shape,
wrong under this environment's `puppeteer-core`) across every file in `Tools/board-check/**` you own.
While closing this round's refresh, direct testing found **the identical bug class in at least three
project-owned test files that your fix didn't reach, because they're outside your boundary**:
`Projects/integer-foundry/test/browser.mjs` (the exact `waitForFunction` shape), `Tools/name-picker/
test/browser.mjs` (`waitForFunction` plus multiple `page.textContent()` calls), and
`Tools/seating-chart/test/drive-seating.mjs` (`page.textContent()` plus `page.isHidden()`, both
Playwright-only). Each has been written into that project's own prompt as a task-one item, with exact
line numbers and the fix (import `waitFor`/`textContent` from your own `Tools/board-check/drive.mjs`,
which already exports engine-aware versions). **Not yours to fix** — but if a round-3 thread reports
a fourth instance in a different project's test file, that's worth a mention in the handoff as a
pattern, since it means whatever review caught the first three missed something systematic (every
project that wrote its own browser-driven test folder by copying a `waitForFunction`/`textContent`
call shape from an earlier, Playwright-only-era example).

## A rendering-environment limitation, found this round — read before trusting `npm run games`

**This environment's three.js rendering is very slow and inconsistent under its forced Linux
software-rendering path** (`harness.mjs`'s `--use-gl=angle --use-angle=swiftshader` flags). Measured
directly against Castle Conundrum: ten 400ms held-`KeyW` bursts covered 0.78m against a ~20m
expectation. This is not a regression and not specific to anything round 2 touched — it's a property
of this sandbox, newly visible now that the `waitForFunction` crash (above) stopped masking every
suite before it got far enough to hit a timing-sensitive assertion. **Locked decision #53** covers
this: treat a real-time movement or physics assertion failing here as inconclusive, not confirmed,
and re-verify from a machine where `harness.mjs`'s non-Linux branch applies (real Chrome/Edge via
Playwright) before trusting either a pass or a fail. This blocked Castle Conundrum's requested
preview recapture again this round (see task one) and left Golden Hour's and The Fourth Quarter's
new beats written but unverified.

## Update from a fair environment — this refresh ran the whole suite on real Chrome/Playwright, not the Linux sandbox

This prompt-22 refresh happened to run on a machine where `harness.mjs`'s non-Linux branch applies
(real Chrome via Playwright, not forced software rendering). That's exactly the "fair environment"
the section above calls for, so the three items it left open all got a real answer:

- **Castle Conundrum's recapture: unblocked, done.** `npm run play` passed all 32 beats with real
  movement ("walked to the Scholar 3.2m after 4 bursts"), and `npm run previews castle-conundrum`
  reached gameplay at "6.48m off the gatehouse" (the requested 6.4m standoff). Fresh candidates are
  sitting in `Tools/board-check/candidates/`, dated this refresh, with `chosen.json` already naming
  a frame. Nobody has looked at them or run `npm run promote` yet — see prompt 05's task two.
- **Golden Hour's wading/footprint beats: verified, and they fail — but not because of anything in
  Golden Hour's own code.** Reproduced twice, identical: eye height climbs (7.85 -> 10.08/10.09)
  instead of settling, and 0 footprint instances. Root cause is in `play-games.mjs` itself: the
  suite reorients the camera twice before the wading test (`lookAt` to 1.2 rad, then a 900ms
  `ArrowLeft` hold that adds ~1.03 rad with no re-aim after), so `KeyW` walks the character inland
  toward the dunes instead of toward the sea. **Fix:** re-aim toward the sea (e.g. `lookAt(p,
  {facing: 0, pitch: -0.05})`) immediately before the wading test holds `KeyW`. Golden Hour's own
  `test/smoke.mjs` (38/38) already proves the wading-limit math and footprint placement are correct
  in isolation — this is a test-sequencing bug, not a game bug, and it's yours to fix, not prompt
  08's.
- **The Fourth Quarter's Real Estate walk-to-station beat: verified, and it fails — also not a game
  bug.** `walked to the Real Estate station — never got in range`, reproduced twice. Root cause:
  `drive.mjs`'s `walkTo()` steers via `aimAt()`, a **raw** `camera.rotation.set(...)` write — but
  Fourth Quarter's `js/player.js:182-184` overwrites `camera.rotation` from its own internal
  `yaw`/`pitch` every frame (real `mousemove`-driven), exactly the situation locked decision #35
  warns about (a raw write only sticks where `PointerLockControls` owns the camera). Every
  `aimAt()` call gets stomped the next frame. **Fix:** give `walkTo()` a `lookAt`-style steering
  option (synthetic `mousemove` events, the same mechanism single-target `lookAt()` calls already
  use) for games that hand-roll their own camera rotation, or write a project-specific walk helper
  that calls `lookAt()` per burst instead of `aimAt()`. This is `drive.mjs`'s only current call site
  for `walkTo()`, so nothing else depends on today's behavior.
- **Daredevil's Stunt Run timeout does not reproduce here.** `smoke-page.mjs` passed 44/44 clean,
  including four stunt-run results, no retry needed — confirms that failure was this sandbox's
  rendering slowness, not a real bug, same pattern as the other three.

None of this is a claim that the Linux sandbox's own future runs will behave differently — locked
decision #53 still holds for that environment. It's a real answer for the two specific beats and
the one recapture that were left as open questions, from the fair environment the decision itself
calls for.

## A Windows-checkout false positive, found this round — read before trusting `npm run social:check`

**`npm run social:check` reports 5 pages "out of date" on a Windows checkout with
`core.autocrlf=true` (this repo's local config on the machine this refresh ran on) even though
their content is byte-for-byte correct.** `sync-social-tags.mjs` compares each page's embedded
`gvb:social` block against a freshly generated one joined with plain `\n`. The five most recently
committed pages (`Projects/daredevil/index.html`, `Projects/torchbearer.html`,
`Projects/fourth-quarter/index.html`, `Projects/Ren-Faire-Claude/index.html`, `newindex.html` — all
five touched in round 2's last few commits) get checked out with `\r\n` line endings on a machine
where autocrlf converts LF-stored blobs to CRLF on checkout; older, untouched-on-this-machine files
still carry whatever line ending they had before. The generated block's content matches exactly
(verified by hand for `daredevil/index.html`: title, description, `og:url`, `og:image` all correct)
— only the line endings differ. **Do not run `npm run social` to "fix" this** — it would just
rewrite the files with LF again, and the next checkout on a Windows machine with this git config
would immediately reintroduce the same false DRIFT. This needs either a `.gitattributes` entry
forcing LF for `*.html` repo-wide, or `sync-social-tags.mjs`'s own comparison normalizing line
endings before comparing. Neither is done — flagging it as found, not fixed, since it's a real
`Tools/board-check/**` change and outside a refresh session's boundary either way.

## Two things resolved this round — don't re-surface as open

1. **The Final Grade Checker's grading-arithmetic correction (prompt 16).** Round 1 fixed a live
   percentage-rounding bug. Round 2 found and fixed a second, smaller one (quality points don't round
   up at .5, unlike the percentage average) by asking Devon directly. **This individual project's own
   prompt now carries a "Questions for Devon" block** with the remaining open question (does any real
   report card graded in the affected window need revisiting) — that's the new durable home for this
   kind of question, not this file. Confirm it's still there when you read prompt 16's file.
2. **The committed schedule data (prompt 19).** Devon decided this round: **leave it as is.** Fully
   resolved — don't re-surface it.
3. **The Pathfinder Campaigns/Characters merge recommendation.** Devon decided this round, via prompt
   03 extended with his sign-off: **harmonize, don't share.** `[shared]` comment markers exist now in
   both files as a drift guardrail; no shared file was created; locked decision #17 stays in force.
   Fully resolved — a recurring backlog item across two rounds, now closed.

## A new durable convention, starting this round: "Questions for Devon" blocks live in project prompts

Prompt 22's refresh now embeds a project's genuinely open Devon-decisions directly in that project's
own prompt file, near the top, as a labeled "Questions for Devon" block — not just as prose in the
handoff. This means: when you write `gvb-site-handoff-v10.md`, **check each project's own prompt file
for a "Questions for Devon" block before summarizing that project's open decisions in the handoff** —
that block is now the source of truth for what's still unresolved, not this file's memory of it. If
Devon answers one directly (in conversation, in a commit, in a decision recorded here), that's a
prompt-22 job to remove from the block and record durably — not yours to edit in a project's prompt
file, since that's outside your boundary. Just make sure the handoff records the answer clearly so
prompt 22's next refresh can close it out.

**One remaining open question that's now centralized rather than scattered**: `Pathfinder/data/` as
a shared interface or private to prompts 01-03 — raised a fourth and fifth time this round by
Torchbearer and The Absalom Inheritance. It now lives in prompt 01's own "Questions for Devon" block
(01 owns the path). If it's still unanswered when you write the handoff, repeat it there too — it's
been raised five times across two rounds and is cheap for Devon to decide.

## Required reading

1. This whole file.
2. `Claude Prompts/README.md` — how the twenty-one-way split works and which prompt owns what.
3. **Your own notes file from last round, `Claude Prompts/notes/21-general-site-improvements-notes.md`.**
   It records exactly what round 2 applied and refused, request by request — including its own
   partial-pass-then-full-pass structure. The archived copies under `Claude Prompts/archive/round-1/`
   and `Claude Prompts/archive/round-2/` hold everything from before that.
4. `gvb-site-handoff-v9.md`, all of it, then §10's locked-decision list (through #53) plus the earlier
   lists it cites.
5. `Tools/board-check/README.md`, then `harness.mjs`, `drive.mjs` (new `waitFor`/`wait`/`textContent`
   helpers, documented there with the exact crash message so future call sites copy the right shape),
   `sync-social-tags.mjs`, `check-integrity.mjs`, `capture-previews.mjs`, `games.mjs`, `tools.mjs`.
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
  rendered Chromium is inconclusive, not confirmed** (locked decision #53). See above.

## Task one: apply every Shared-file request (after the other twenty finish)

Read all twenty notes files. Each has a **Shared-file requests** section written to be applied
without reading that session. What to expect, based on what the last two rounds taught:

- **Board card rewordings and `href` changes**, especially from any thread that restructured a
  single-file project into a folder. Verify a restructure actually needs a board edit before assuming
  it does — several threads found ways to restructure without touching the URL.
- **Requests for new `gvb-save.js` hooks.** **Reconcile before you implement** if two threads
  independently ask for the same shape of thing.
- **Regression-suite changes to `play-games.mjs` or `games.mjs`.** Apply the spirit of the request,
  adapt where the actual code doesn't match the sketch, and say so in your notes.
- **New preview/OG requests, or recapture requests.** Check locked decision #53 above before
  attempting one for a three.js game — a recapture that can't complete here isn't a code problem.
- **The three cross-cutting `waitForFunction`/`textContent` bug reports** (see above) — these are
  each already written into their own project's prompt as that project's own task one. Don't apply
  them yourself; they're outside your boundary. Confirm each project's own session actually did it
  before assuming it's closed.
- **Two new `play-games.mjs`/`drive.mjs` bugs, found this refresh from a fair environment** (see "Update
  from a fair environment" above) — these are yours to fix, not any project's: (1) the golden-hour
  wading-test beat needs a re-aim toward the sea immediately before it holds `KeyW`, since two prior
  look-tests leave the camera heading inland; (2) `drive.mjs`'s `walkTo()` needs a `lookAt`-style
  steering option for games that hand-roll their own camera rotation (starting with The Fourth
  Quarter's Real Estate beat) instead of its current raw `camera.rotation.set()` write, which gets
  silently overwritten every frame on any game that doesn't use `PointerLockControls`.

When you touch `gvb-save.js`, `node assets/js/gvb-save.test.mjs` must still pass — currently
**50 passed, 0 failed**. Every project that imports it must still work — run their suites, don't just
trust the module's own test. Current adopter list (eleven projects): The Fourth Quarter, Aphelion,
Torchbearer, The Absalom Inheritance, Daredevil, Integer Foundry, The Fracture Cycle, Name Picker,
Closing Time, Corner & Kettle, Seating Chart Generator. **Corner & Kettle's and Seating Chart's own
"invert the stale assertion" tasks are both done and confirmed clean this round** (166/0 and 153/0
respectively) — don't re-flag either as outstanding; a prior handoff draft got this wrong, so verify
against the actual test file output, not against what an earlier note claimed.

## Task two: version line and handoff (after task one)

- **Bump the version line** in `index.html` from `version 10` to `version 11`.
- **Write `gvb-site-handoff-v10.md`**, assembled from all twenty-one notes files plus your own work.
  Follow the shape of v9: a one-paragraph summary, numbered sections, a backlog-state table, a
  "things I found and deliberately did not fix" section, a locked-decisions section carrying the
  previous fifty-three forward and numbering new ones from 54, a suggested-next-session list, and a
  "Verified this session" list.

Things that should end up in it, if the round bears them out:

- Whether Golden Hour's and The Fourth Quarter's new beats got verified from a fair environment this
  round (see the rendering-environment section above).
- Whether Castle Conundrum's preview recapture succeeded this round.
- Any answer to the `Pathfinder/data/` question, if Devon weighed in.
- Any new locked decisions from 54 onward.
- **A note on the "Questions for Devon" convention** (see above) — which project prompts carry one,
  and whether any got answered and should be marked resolved for prompt 22's next refresh.

## Verification

- `cd Tools/board-check && npm run check` → currently **335 units, 0 broken, 0 collisions across nine
  widths, tightest vertical gap 3.5px** (moves a little run to run; 0 broken is what matters).
- `npm run social:check` → currently **17 notices, 17 already current, 0 out of date, 0 failed**
  (dropped from 22 this round — a real, correct count after Devon consolidated six Tools notices into
  one card).
- `node assets/js/gvb-save.test.mjs` → currently **50 passed, 0 failed**.
- `npm run tools` → currently **18 checks, 0 failed**.
- `npm run games` → fixed this round, and **on a fair environment (real Chrome/Playwright) it is
  not a moving target at all** — this refresh ran it twice and got the identical result both times:
  **137 checks, 3 FAILED**, all three explained above (Golden Hour's two beats, Fourth Quarter's
  Real Estate walk). On this Linux sandbox specifically, still expect run-to-run variance per locked
  decision #53 — that decision is about this environment's rendering, not about the suite itself.
- `npm run previews` → confirm whichever games you touched still reach gameplay, with the caveat
  above for three.js games specifically.
- Every project suite whose files you touched through a shared-file request.
- **Confirm zero live offsite requests, repo-wide**, as a final check before writing the handoff.
- **Locked decision #34**, on anything you touch in `gvb-save.js` or `check-integrity.mjs`.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window nobody is looking at (v7 §6). Other threads may be running
these suites; only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/21-general-site-improvements-notes.md` **as well as**
`gvb-site-handoff-v10.md`. The notes file records what you did; the handoff records what the whole
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
