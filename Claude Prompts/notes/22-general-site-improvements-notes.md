# General Site Improvements — session notes

Full pass. This session's first pass (preserved as the "Partial pass" section
below its own header the moment this file was rewritten — see git history if
you need that record) stopped after nine of twenty project notes files
existed and correctly refused to write a handoff from an incomplete set. By
the time this second pass started, `origin/main` had moved: all twenty exist
now, none touch a shared file directly (confirmed: `git diff --name-only`
against this session's own starting commit touches only each project's own
paths plus its own notes file), and tasks one and two both ran.

## What changed

**Task one — the live problem, first, per this prompt's own instruction.**
`newindex.html` (a Town Services landing page Devon committed directly,
mid-round, linked from a new `index.html` notice) hotlinked Google Fonts and
had hand-written icon/`og:*` tags; vendored its fonts into `assets/fonts/`
(new locked decision #51 extends #43 to cover it) and let `sync-social-tags.mjs`
manage it like any other linked page. The notice-parse "failure" this same
commit caused wasn't a markup break at all — the six standalone Tools
notices really were replaced by one "School Tools" card, a genuine drop from
22 to 17, and `sync-social-tags.mjs`'s hardcoded `< 20` safety floor was
refusing a correct number. Lowered to 15 (same two-notice buffer as before,
relative to the new count) with a comment explaining why. Full account:
`gvb-site-handoff-v9.md` §1–2.

**Task one — the `waitForFunction` bug, reported independently by three
threads.** `page.waitForFunction(fn, null, opts)` — Playwright's shape —
throws under this environment's `puppeteer-core`, on every single call, for
every game, the whole round. Fixed once: new `waitFor(page, fn, opts)` in
`drive.mjs`, branching on `page.__engine`, used everywhere in
`drive.mjs`/`play-games.mjs`/`capture-previews.mjs`/`games.mjs`. Two more
engine differences surfaced once this stopped masking them — `page.waitForTimeout`
(gone from recent `puppeteer-core`; `drive.mjs`'s own `wait()` needs no
engine branch) and `page.textContent()` (Playwright-only; new `textContent()`
helper) — both fixed the same way. **Not applied to `play-castle.mjs`**
(prompt 05's file) or `Projects/integer-foundry/test/browser.mjs` (prompt
14's own test file, found to have the identical bug while verifying this
fix, not something this thread's own request list surfaced) — both flagged
in the handoff instead. Full account: `gvb-site-handoff-v9.md` §3.

**Fixing that bug exposed a bigger one this session could not fix**: this
environment's three.js rendering, under the forced Linux software-rendering
path, is very slow and inconsistent in real time — measured directly against
Castle Conundrum (ten 400ms forward-walk bursts covered 0.78m against a
~20m expectation; several individual bursts covered exactly zero). This
affects every real-time movement or physics assertion in `npm run games`/
`npm run previews`, not anything specific to what this session touched. Full
account and recommendation: `gvb-site-handoff-v9.md` §4.

**Torchbearer's preview, OG card, and `npm run games` entry** — unblocked
now that `Projects/torchbearer/test/sera-voss.torchsave.json` is a real
committed save. Recipe added to `games.mjs` (Shelf-load Thornwake, dismiss
the "Content Loaded" modal that would otherwise sit on top of `#save-bar` and
eat the next click, import the save, land on `bridge-fog`); `play-games.mjs`
suite added (7 checks, 0 failed — a 2D DOM game, not three.js, so none of it
is affected by the finding above); preview captured and promoted (9.2 KB /
64.4 KB); `promote-previews.mjs`'s `KNOWN` allowlist and `index.html`'s
`data-preview` attribute both updated.

**Golden Hour's wading/footprint beats and The Fourth Quarter's Real Estate
suite** — both added to `play-games.mjs`, both correctly gated to skip
cleanly rather than cascade when they can't complete in this environment
(confirmed neither crashes; both log one clear, honest failure and move on).
Golden Hour's request read `pos[1]` for eye height in its own sketch;
`camState`'s `pos` is `[x, z]` only, eye height is the separate `y` field —
adapted. Fourth Quarter's suite is appended as its own self-contained block
rather than threaded into the middle of the existing door-panel sequence,
which tests an adjacent flow at a different venue tier and would have been
put at risk by interleaving a venue change into it.

**Daredevil's board `href` and `games.mjs` recipe** — repointed from
`Projects/daredevil_r4.html` (now a redirect stub) to `Projects/daredevil/`.
`npm run social` re-run afterward for the new `og:url`. Verified against a
real `npm run previews daredevil` run (reached gameplay clean, no recipe
changes needed beyond the URL) and Daredevil's own `smoke-page.mjs` (36 of
37 — the one failure is the rendering-environment finding above, confirmed
unrelated: `git diff` shows nothing under `Projects/daredevil/` touched by
this session).

**`Tools/board-check/package-lock.json` is tracked now** (Closing Time's
request) — `node_modules/` stays ignored.

**Task two — version bumped 9 → 10, `gvb-site-handoff-v9.md` written.**

## What I verified

Full commands and output are in `gvb-site-handoff-v9.md`'s "Verified this
session" section — not repeating them all here. Headline numbers:

```
cd Tools/board-check && npm run check
  336 units checked, 0 broken; 0 collisions, tightest gap 3.5px

npm run social:check
  17 notices, 17 already current

node assets/js/gvb-save.test.mjs
  50 passed, 0 failed (module untouched this round)

npm run tools
  18 checks, 0 failed

npm run games
  moving target in this environment (see gvb-site-handoff-v9.md §4);
  a representative full run: 119 checks, 8 FAILED, Torchbearer's new
  suite clean at 7/7

npm run previews torchbearer / daredevil
  both reached gameplay, 0 failed

npm run previews castle-conundrum
  could not reach gameplay — see below and the handoff §4/§8
```

**Locked decision #34**, twice: reintroduced `newindex.html`'s font hotlink,
watched `npm run check` fail naming it, removed it, watched it pass again.
Observed `sync-social-tags.mjs`'s actual pre-fix state directly (17 parsed,
floor at 20, exit 2) before lowering the floor, then confirmed it passes.

**Castle Conundrum's recapture, attempted and not completed.** `npm run
previews castle-conundrum` aborted: "never got 6.4m clear of the gatehouse."
Measured the walk speed directly with a throwaway script rather than assume
— ten 400ms held-`KeyW` bursts covered 0.78m total (nominal expectation at
the documented 5.2 m/s walk speed is close to 20m), several bursts covered
exactly zero. This is the same class of environment limitation Golden Hour's
own round-2 session already found for its walk/sun/fog assertions, now
confirmed on a second, independent game. Did not promote anything; the
existing (stale, per prompt 05's request) preview is untouched rather than
replaced with nothing or with a broken capture.

## Requests applied, and requests refused

Every request from every one of the twenty notes files, and what happened to
it.

**01 Anathema Archive, 02 Pathfinder Campaigns (merge recommendation, not a
request), 04 Aphelion, 09 Faire Weekend, 15 The Fracture Cycle, 17 Image to
PDF, 19 Schedule Visualizer/Browser** — confirmed no shared-file request in
each, checked against this round's own notes file rather than assumed.

**03 Pathfinder Characters** — not a request: a record of work already done
in `campaigns.html` (prompt 02's file) with Devon's explicit go-ahead this
round, harmonizing the two pages' shared chrome with `[shared]` comment
markers rather than creating an actual shared file. Nothing for this thread
to apply; noted prominently in the handoff since it resolves a recommendation
raised three times across two rounds.

**05 Castle Conundrum** — recapture requested, attempted, not completed. See
"What I verified" above and `gvb-site-handoff-v9.md` §4/§8. This is the
second round this request has gone unfulfilled, for two different reasons
each time (round 1: not yet asked; round 2: asked and blocked by environment)
— flagged clearly rather than silently carried forward a third time.

**06 Closing Time** — two requests, both applied: the `waitForFunction` fix
(see "What changed") and tracking `package-lock.json`.

**07 The Fourth Quarter** — two requests, both applied: the `waitForFunction`
fix (this thread's own exact call-site list came from this notes file) and a
new Real Estate suite for `play-games.mjs`. The suite is written and
verified not to crash; it could not complete a real run in this session's
environment (see "What I verified").

**08 Golden Hour** — three items: the `waitForFunction`/`waitForProbe` fix
(applied — this thread's own version, the `page.__engine` branch, is the one
that shipped, since it was the cleanest of the three independent proposals),
two new `play-games.mjs` beats (applied, adapted for the real `camState`
shape), and "nothing needed in `games.mjs`/`capture-previews.mjs`"
(confirmed, no change made).

**10 Torchbearer** — four items. Preview/OG/`npm run games` entry: applied,
now that the fixture exists (see "What changed"). `newindex.html`/
`sync-social-tags.mjs` flags: fixed (see task one above). `Pathfinder/data/`:
still not code, surfaced again in the handoff.

**11 The Absalom Inheritance** — "nothing needed" (no `href` change, no
`gvb-save.js` gap, no preview update) confirmed, not applied. `Pathfinder/data/`
raised again alongside Torchbearer's — both surfaced in the handoff.

**12 Coffee Shop Sim / Corner & Kettle** — none; both round-1 `gvb-save.js`
gaps already fixed on disk, confirmed by this session, not re-applied.

**13 Daredevil** — all required requests applied: board `href`, `games.mjs`
recipe URL, social tags regenerated. Verified against a real preview run and
the project's own smoke suite (see "What I verified").

**14 Integer Foundry** — no new request (round 1's `play-games.mjs` seeding
removal is still in place, confirmed, not re-applied). Not requested by this
project, but found while verifying the `waitForFunction` fix: its own
`Projects/integer-foundry/test/browser.mjs` has the identical bug at line
199. Not this thread's file — flagged in the handoff backlog rather than
edited.

**16 Final Grade Checker** — `newindex.html`/`sync-social-tags.mjs` flags
fixed (task one). Nothing needed from `gvb-save.js` or `tools.mjs`, confirmed.

**18 Name Picker** — no new request (both round-1 `gvb-save.js` requests
already applied, reconfirmed by this project's own session, not this
thread's to re-verify further). `newindex.html`/social flags fixed. The
round-1 leftover suggestion (rename `Name Picker.html`, update the board
`href`) — Name Picker's own round-2 session considered and declined it again
this round too ("with roughly twenty other sessions in this repo... not
something I did"), so there is no active request to apply; left as a
standing, undecided suggestion in the backlog rather than acted on
unprompted.

**20 Seating Chart Generator** — none; its one `gvb-save.js` gap was already
applied before this session started, confirmed not re-applied.

## Deliberately not done

**The two same-class `waitForFunction` bugs outside this thread's boundary**
(`play-castle.mjs` line ~432, prompt 05's file; `Projects/integer-foundry/test/browser.mjs`
line 199, prompt 14's file). The fix is a one-line, mechanical match of what
shipped everywhere else in `Tools/board-check` this session, but both files
are outside this prompt's ownership for reasons the prompt itself gives
(Castle Conundrum's beats need a session that can verify them; a project owns
its own test suite) — flagged in the handoff rather than edited.

**Castle Conundrum's preview recapture.** Attempted, genuinely blocked by
this session's rendering environment, not by anything in scope to fix from
inside this thread. See "What I verified" and `gvb-site-handoff-v9.md` §4/§8.

**Golden Hour's and The Fourth Quarter's new beats, left unverified for
real.** Both are written, wired, and confirmed not to crash or cascade when
the environment can't support them — but neither has actually been watched
pass in a session where the environment allows it. Flagged clearly rather
than claimed as verified.

**Renaming `Tools/Name Picker.html`.** Not this thread's call to make
unprompted — see "Requests applied" above. Left exactly as Name Picker's own
session left it.

**Corner & Kettle's and Seating Chart's one expected-failing test each**
(carried over from v8's backlog). Neither project's round-2 notes mention
inverting it, so it's still outstanding — not this thread's file to edit
either way.

## Next session

Ordered by value per effort:

1. **Re-verify Golden Hour's and The Fourth Quarter's new beats from a
   machine with working real-time three.js rendering** (real Chrome/Edge via
   Playwright, not this environment's forced Linux/software-rendering path).
   The code is ready; it just hasn't had a fair environment to prove itself
   in yet.
2. **Apply the one-line `waitForFunction` fix to `play-castle.mjs` and
   `Projects/integer-foundry/test/browser.mjs`** — from those prompts' own
   sessions.
3. **Castle Conundrum's preview recapture**, once (1) is settled.
4. **Invert Corner & Kettle's and Seating Chart's one expected-failing test
   each** — still outstanding two rounds running now.
5. **`Pathfinder/data/`** — raised a fourth and fifth time this round.
   Cheaper for Devon to decide now than to keep carrying it forward.
6. Everything else each of the twenty projects flagged in its own "Next
   session" section — unchanged by this session, carried forward in the
   handoff's backlog table.
