# gvb-site-handoff-v8.md

Handoff from **session 8** (site version 9) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v7.md` first if you have not. Everything in it still
holds unless contradicted below — and §5 is contradicted below, at length.

This was not one session in the usual sense. `Claude Prompts/README.md`
describes a twenty-one-way parallel split: twenty threads each took one
project, wrote what they needed from the shared files into their own notes
file, and this thread — prompt 21, "General Site Improvements" — owns
`index.html`, `404.html`, `assets/js/gvb-save.js`, `Tools/board-check/**`
(except `play-castle.mjs`), and `CNAME`, and applies every one of those
twenty notes files in one pass at the end. All twenty existed when this
session started, so this is that full pass, not a partial one.

**`CNAME` is gone from the repo, deleted directly by Devon** rather than by
any of the twenty-one prompts — he's mirroring the site on Cloudflare now
instead of serving the custom domain straight off GitHub Pages. Noted here
because this thread owns that path and the deletion predates this session's
work; nothing else in the repo hardcodes the old arrangement in a way that
needed a matching change.

---

## Two things that matter more than anything below

**Prompt 16 (Final Grade Checker) found a live grading bug.** The tool's
"round up at exactly .5" rule was implemented as `Math.round(n*10) >= 895`,
which rounds the average to one decimal *before* comparing it to the
boundary — so the real cutoff sat at x.45, not x.5, at all four letter
boundaries. Of the 40,001 possible quarter-percentage averages, 80 landed a
letter too high, twenty at each boundary. The twenty at the bottom are the
ones that matter: a student averaging 59.40–59.4999% was reported a **D**
where the rule says **F**. This was live on `Tools/final_grade_checker.html`
for the tool's whole history — a corrected module (`grade-math.mjs`) already
existed in git from an earlier commit, but the page never imported it until
prompt 16's session wired it up this round. It is fixed now, with 119
passing assertions, but if this tool was used on any actual report card
before this session, the correction moves some grades **down**, specifically
in the x.45–x.4999 band at each boundary. Worth knowing before trusting any
grade this tool produced before today.

**Prompt 19 (Schedule Visualizer) found a possible school-security exposure
in committed data, not a bug.** `Tools/schedule-browser.html` and
`Tools/schedule-visualizer.html` (published, no login) carry
`PUBLISHED_DATA`: 34 real East Middle teacher surnames, their rooms,
departments, sections, and — combined with a full floor-plan SVG — **which
block is each teacher's planning period**, on both A and B days. Individually
any of that is the kind of thing on a door or in a staff directory. Together,
the floor plan plus the planning-period schedule says where a named adult is
*not*, at each of four times of day, on a public URL. Prompt 19 did not
remove anything — that is a judgement call, not theirs to make — but flagged
it explicitly and left three options on the table: leave it, stop publishing
the file and hand it out as an email attachment instead (the tool already
names the download `Schedule_Browser_EMS_<date>.html`), or take the page
down. Nothing about this correction needs any of the twenty-one prompts;
it needs Devon to look at `Tools/schedule-browser.html` and decide. See the
backlog table.

---

## 0. What changed in one paragraph

Six tasks. **The Bestiary Gallery is gone** — it hotlinked 3,894 images from
`2e.aonprd.com`, unnoticed for the site's whole history because no suite ever
opened it, and the board drops from 23 notices to **22** as a result (§1).
**v7 §5's "zero offsite requests site-wide" was wrong**, and the reason it
looked right is now fixed: the font shim in `harness.mjs` was fulfilling
Google Fonts requests before the blocked-list check ran, so a hotlink never
reached `page.__blocked` (§2). **`index.html` and `404.html`'s fonts are
vendored**, closing the two pages this thread owns out of the fifteen that
were still hotlinking when the round of twenty started (§3). **The shared
save module, `gvb-save.js`, went from one adopter to eleven this round**, and
five different real gaps surfaced across four of them — all fixed, all
backward compatible, all in the module now rather than four separate
workarounds (§4). **`play-games.mjs` grew from 94 checks to 126** across six
games, and **a new `tools.mjs` closes the "nothing ever opens a Tools page"
hole** that let the grading bug above and the font hotlinks both hide in
plain sight (§5). **Four of five preview-less games now have one**; the
fifth (Torchbearer) needs a real playthrough to generate a save file, which
is next session's cheapest win (§6).

---

## 1. The Bestiary Gallery is gone — 22 notices, not 23

`Tools/creature_artwork_gallery.html` — an index of Archives of Nethys
bestiary art that hotlinked every image — deleted, along with its notice in
`index.html`'s Pathfinder section (locked decision #3 placed it there
deliberately; it's a PF2e reference tool, not a schoolhouse one, and that
placement stands as history even though the tool is gone). Devon's call, for
the reason he gave (the links are broken and the tool isn't useful); the
stronger reason for the record is that it made **3,894 requests to
`2e.aonprd.com`**, the largest offsite dependency the site has ever carried,
by three orders of magnitude, unmeasured for the site's whole history because
`play-games.mjs` and `play-castle.mjs` only ever open the seven games.

**Every "23 notices" figure in every other prompt and in v7 is now stale.**
`npm run social:check` reports **22 of 22 current**. `sync-social-tags.mjs`
hard-fails below 20, so 22 is safe, but read it as the new baseline, not a
regression.

## 2. v7 §5 was wrong, and the suite could not see it

v7 §5 said the site made zero offsite requests site-wide. That was true only
of the seven games `play-games.mjs` and `play-castle.mjs` drive. It was
false for the other fifteen pages the twenty parallel threads found still
hotlinking Google Fonts, and the reason is structural, not an oversight:

```js
if (/fonts\.googleapis\.com\/css/.test(u))   return route.fulfill({ ...fontCssFor(u, base) });
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u)) return route.fulfill({ ... });
// ... only after that:
if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { blocked.push(...); return route.abort(); }
```

`harness.mjs`'s font shim answers a Google Fonts request locally, from
bundled `@fontsource` packages, so screenshots render with the right
typefaces — that part is right and stays. But it means the request **never
reaches the blocked-list check**, so `page.__blocked` reports empty
regardless of whether the page still hotlinks. The old docstring said the
empty `allow` list "is what makes `page.__blocked` an honest inventory" —
that was wrong the moment a second page hotlinked fonts, and it is corrected
in place now.

**Two fixes:**

- `harness.mjs`'s `prepPage()` now returns `page.__shimmed`, an array of every
  URL the font shim satisfied. `__blocked` is "refused"; `__shimmed` is
  "fulfilled instead of refused." A page reporting empty `__blocked` and a
  non-empty `__shimmed` still hotlinks fonts.
- `check-integrity.mjs` gained a static source sweep: every `.html` in the
  repo, grepped for `<link>`/`<script>`/`<img>`/`<iframe>`/`<source>`/
  `<audio>`/`<video>`/`<embed>` tags and CSS `url()`s pointing offsite,
  excluding the site's own domain. This is the check that actually scales —
  no browser needed, and it covers the 15 pages no suite ever drives, which
  is exactly how both the font hotlinks and the Bestiary Gallery went
  unmeasured. `<a href>` is deliberately excluded — a navigation link isn't a
  request the page makes on its own.

**Verified per locked decision #34**: added a font hotlink back to
`index.html`, ran `npm run check`, watched it fail
(`references offsite host(s): fonts.googleapis.com`), removed it, watched it
pass again.

By the time this session ran, the eighteen other project threads had already
vendored their own fonts in parallel (each had its own "vendor your fonts"
task). This thread's two pages, `index.html` and `404.html`, were the last
two — see §3.

## 3. `index.html` and `404.html`'s fonts are vendored

Both hotlinked Alegreya, Alegreya SC and Grenze Gotisch. Read from the CSS
rather than the hotlink URL (which asked for Alegreya SC 500 and an extra
Alegreya italic weight that neither page's stylesheet actually sets): five
files, **106.8 KB total**.

| File | Weight / style |
| --- | --- |
| `alegreya-latin-400-normal.woff2` | Alegreya 400 normal |
| `alegreya-latin-400-italic.woff2` | Alegreya 400 italic |
| `alegreya-sc-latin-400-normal.woff2` | Alegreya SC 400 normal |
| `grenze-gotisch-latin-500-normal.woff2` | Grenze Gotisch 500 normal |
| `grenze-gotisch-latin-700-normal.woff2` | Grenze Gotisch 700 normal |

They live in **`assets/fonts/`** — shared between the two pages rather than
duplicated, which is new locked decision #43 below. `404.html`'s `@font-face`
`src` URLs are root-absolute (`/assets/fonts/...`); `index.html`'s are
relative. That split is locked decision #8 applied correctly: `404.html`
renders at whatever deep subpath actually 404'd, so a relative path there
resolves against the wrong base.

## 4. The shared save module: one adopter to eleven, five real gaps found and fixed

`gvb-save.js` had one adopter (The Fourth Quarter) across the first seven
sessions. This round, eleven of the twenty parallel projects adopted it:

| Project | Storage key | What its adoption found or needed |
| --- | --- | --- |
| The Fourth Quarter | `fq3d-save` | (reference integration, session 7) |
| Aphelion | `aphelion-save-v1` | Save bar in the logbook, not a title screen |
| Closing Time | `closingTime.save.v1` | `repair` also covers **content drift**, not just schema drift; `fresh`/`reset` argument forwarding; `clear()` |
| Torchbearer | `torchbearer-save` | `mountSaveBar`'s `filename` option; the import-handler ordering fix |
| The Absalom Inheritance | `absalom-inheritance-save-v1` | (no gaps — third adopter to report the module needed nothing new) |
| Corner & Kettle | (own key) | The `load()`/`getItem` guard and the construction-time `typeof localStorage` throw |
| Daredevil | `daredevil-save-v1` | (no gaps) |
| Integer Foundry | `integer-foundry-save-v1` | `slot.autosave()` replaced a hand-rolled 8-second interval |
| The Fracture Cycle | `fracture-cycle-v1` | Smallest adoption on purpose — one array, not a mid-story save |
| Name Picker | (thirteen `np_` keys) | The same `load()` guard; `mountSaveBar`'s `filename`; documented the "can't hold an array or scalar" limit |
| Seating Chart Generator | `seating-chart-v1` | The same construction-time throw; `mountSaveBar`'s `labels` |

Five distinct, real gaps came out of this, reconciled into one set of changes
rather than four separate workarounds — no two adopters asked for exactly the
same fix twice, so all five landed:

1. **`typeof localStorage` itself can throw**, in a browser configured to
   block storage — it's a declared accessor, not an undeclared identifier, so
   the read throws before `defaultStorage()`'s own `try/catch` runs.
   `createSaveSlot()` now guards the check too, exactly the case the memory
   fallback exists for.
2. **`load()`'s `getItem` call was unguarded.** Now wrapped, matching
   `save()`'s existing shape.
3. **`fresh(...args)` / `reset(...args)`** now forward arguments to a
   `defaults` factory — for a game whose day one depends on a runtime choice
   (which brokerage), not just on randomness.
4. **`clear()`**, new: erase the stored key without building and discarding a
   fresh state first. `reset()` is `clear()` then `fresh()`.
5. **`mountSaveBar`'s `filename` and `labels` options.** `filename` overrides
   the export button's download name (a hero's name, a roster-specific
   filename); `labels` overrides any button's text and title without
   touching its `data-gvb` attribute. The import handler also now calls
   `setState` *before* writing to storage, vetoable by returning `false` — a
   host that rejects an import (an id from an unloaded content pack, say)
   should not have already overwritten what was on disk.

All five are additive; every existing call site is unchanged.
`node assets/js/gvb-save.test.mjs`: **50 passed, 0 failed**, up from 39 —
each new fix has a test that was watched failing first, per locked decision
#34 (one worth naming: the construction-time throw is impossible to
reproduce with a `try/catch` around the call site alone, since the throw has
to come from *reading the property*, not calling a method — the test defines
a throwing getter on `globalThis.localStorage` to reproduce it for real).

**Ran every adopter's own Node suite afterward** to confirm nothing broke:
Fourth Quarter (189), Aphelion (23), Torchbearer (86), Absalom Inheritance
(244), Daredevil (53), Integer Foundry (90), The Fracture Cycle (26), Name
Picker (207) all pass clean. **Two report exactly one failure each, and both
are expected, not a regression**: Corner & Kettle's `smoke-save.mjs` and
Seating Chart's `smoke-seating.mjs` each contain a test written specifically
to assert the *old*, buggy behavior, so it would fail loudly the day the
module was fixed — their own words, almost verbatim from both notes files:
"it will fail loudly and want inverting when the fix lands." It landed. Not
mine to fix (their test files, not this thread's), flagged for next session.

## 5. `play-games.mjs`: 94 checks to 126, plus a Tools sweep that didn't exist

Six of the seven games got new beats this round, all from shared-file
requests, one game (Integer Foundry) had an existing workaround removed
entirely:

- **Integer Foundry** — the flagship fix. The old suite seeded the sink's
  target to a hardcoded 3 and neutered the outgoing page's autosave to make
  it stick, because the old order generator could ask for more than an
  8-cell demo line could deliver. Integer Foundry's own session found and
  fixed the actual bug (orders past the twelfth were routinely unfillable —
  0 wins in 2000 simulated at 30 orders filled with the old generator), so
  the suite no longer needs to cheat: it erases its own demo line, reads
  whatever the sink is actually asking for, and builds a line that delivers
  exactly that.
- **Aphelion, Golden Hour** — save-bar and prop/keyboard/sun-descent beats,
  applied as requested.
- **Faire Weekend** — mid-report save/reload beats, proving a day is final
  once the gates close (see the "report-phase" locked decision below).
  Required one fix beyond the request: `games.mjs`'s `open()` only ever
  waited for `.grounds-map`, which doesn't exist while a report is on
  screen — and a report reaching disk while it's on screen is this session's
  whole point, so a reload can now legitimately resume on one. Widened to
  `.grounds-map, .ticket-stub`.
- **Closing Time** — version stamp, footer save bar, export, import, a
  corrupt save, a legacy save. Needed a modal-dismissal helper the request's
  sketch didn't anticipate (a random event can leave a modal open across a
  reload) and a real DOM-redraw assertion in place of a first draft that was
  too loose to actually prove anything.
- **The Fourth Quarter** — door-panel and box-score save-bar beats (the save
  bar is now reachable on three screens, not just the start overlay — v7 §9's
  long-open item, closed by Fourth Quarter's own session). Needed two
  sequencing fixes: the dev menu's box-score skip only works once a night is
  actually running, and `#wipeBtn` only exists on the start overlay, reached
  by a reload, not a click mid-campaign.
- **Torchbearer** — not added. See §6 and the backlog.

`npm run games`: **126 checks, 0 failed**, all six games, in one run.

**`Tools/board-check/tools.mjs`, new.** Final Grade Checker's finding — three
`cdnjs.cloudflare.com` hotlinks sat in `Tools/final_grade_checker.html`
indefinitely because nothing ever measured a Tools page — generalizes past
one tool. `npm run tools` opens all six Tools pages headless (no WebGL or
pointer lock needed, and headless means it can run alongside a headed game
suite without stealing its focus) and asserts a real title, no offsite
requests, no console errors. **18 checks, 0 failed.**

## 6. Previews: four of five, one deferred on purpose

Five games had neither a board preview nor an OG card at the start of this
round: The Absalom Inheritance, Corner & Kettle, Daredevil, Torchbearer, The
Fracture Cycle. Four now do — recipes added to `games.mjs` and
`capture-previews.mjs`, captured, and promoted (`promote-previews.mjs` needed
its hardcoded `KNOWN` allowlist extended with all four new names, or
`npm run promote` would have silently refused them with "not preview names
the board asks for" — not something any of the four requesting sessions
could have caught, since none of them can run that script).

All four came together on the first or second try of the recipe:

- **The Absalom Inheritance** — the trickiest one. `renderer.screenToGrid`
  inverts the isometric projection, so the recipe scans the canvas in-browser
  for the pixel that maps to grid square (10,13), clicks it, and confirms a
  single sentinel woke. Worked first try; the promoted frame is mid-combat
  with the character sheet, HP, spell slots and a real dice-rolled
  interaction log all in view.
- **Daredevil** — needed one fix beyond the request: the cold open is nine
  scenes deep, and the suggested recipe budgeted 6 Continue-clicks to reach
  the first choice screen. Measured by hand at 14. Widened to 20 with a
  little margin and it lands on "THE MOMENT," Duke's four-option origin
  choice.
- **The Fracture Cycle** — always taking the first offered choice, since
  hand-authoring one specific path through the branch map wasn't worth it for
  a screenshot. Landed on a real ending screen ("The Sanctuary's Dawn") after
  8 choices, with the endings-discovered tracker and the save controls both
  in frame — proves the game and this round's save adoption in one image.
- **Corner & Kettle** — `games.mjs`'s own `open()` already reaches the money
  shot (a filled espresso cup, a waiting customer, the day/currency HUD), so
  this recipe is just the screenshot.

`promote-previews.mjs` needed its hardcoded `KNOWN` allowlist extended with
all four new names, or `npm run promote` would have silently refused every
one of them with "not preview names the board asks for" — not something any
of the four requesting sessions could have caught, since none of them can run
that script. All eight preview/OG pairs promoted well under budget (6.3–14.2
KB for the 330×200 previews, 32.6–103.2 KB for the 1200×630 cards, against a
60 KB / 300 KB ceiling).

**Torchbearer is the one left.** Its own session was explicit: the preview
needs a prebuilt `.torchsave.json` from an actual playthrough of the
nine-step character builder, committed under `Projects/torchbearer/test/`,
because the builder has no shortcut a driver script can take. Building one
blind — without actually playing it — risks shipping a save that fails the
game's own validator the first time anyone reads it, which is worse than no
preview. Left for next session; the recipe and the `play-games.mjs` beats
are both already written out in Torchbearer's own notes file, ready to
transcribe once the save exists.

Also recaptured **Castle Conundrum** and **Golden Hour** — both projects'
own sessions changed enough about how the game looks (Castle Conundrum's
texture-filtering fix and new braziers, both now visible in the promoted
frame; Golden Hour's groyne, wrack line, and moving sun, with the sailboat on
the sun path now the shot) that the promoted card was showing a version of
the game that no longer exists.

---

## 7. Backlog state

| Item | State |
| --- | --- |
| Bestiary Gallery deleted | **Done.** See §1 |
| Offsite-request measurement hole | **Done.** `page.__shimmed` + static sweep. See §2 |
| `index.html`/`404.html` fonts vendored | **Done.** See §3 |
| `gvb-save.js` gaps (5 found across 4 adopters) | **Done.** See §4 |
| `play-games.mjs` beats (6 of 7 games) | **Done.** See §5 |
| `Tools/` sweep (`tools.mjs`) | **New, done.** See §5 |
| Previews for 5 preview-less games | **4 of 5 done.** Torchbearer needs a real playthrough — see §6 |
| Corner & Kettle / Seating Chart's one expected test failure each | **New, not fixed** — not this thread's file to edit. See §4 |
| Grade-arithmetic correction (prompt 16) | **Done**, and it changes real output — see the top of this file |
| Committed schedule data question (prompt 19) | **Flagged, not decided** — Devon's call. See the top of this file |
| `Pathfinder/data/` as a shared interface | **Still an open question.** Raised independently by Torchbearer and The Absalom Inheritance; needs Devon, not code |
| Castle Conundrum's blurry walls | **Fixed this round**, by Castle Conundrum's own session (texture filtering, not a UV/geometry problem after all) |
| Faire Weekend's report-phase save policy | **Decided: a day is final once the gates close.** See locked decision #45 |
| Versioned tool filenames (Schedule Visualizer/Browser) | **Decided: version moved into the page, not the filename.** See locked decision #46 |
| Everything else in each of the twenty projects' own "Next session" sections | **Unchanged by this thread** — see each project's own notes file in `Claude Prompts/notes/` |

## 8. Things I found and deliberately did not fix

**Torchbearer's preview and `npm run games` entry.** Covered in §6. The
honest reason is that generating a valid save file without playing the game
is a coin flip against the validator, and a broken committed fixture is a
worse outcome than a missing preview.

**Corner & Kettle's and Seating Chart's one "failing" test each.** Both are
by design — see §4 — and both need a one-line edit in a file this thread
doesn't own.

**The `Pathfinder/data/` question.** Two independent sessions (Torchbearer,
The Absalom Inheritance) looked at the 24 JSON files of real PF2e Remaster
rules data sitting next to their own hand-authored content packs and asked
whether that data is a published interface other projects can build against,
or private to prompts 01–03. Neither built a runtime dependency on it, both
correctly treated the answer as Devon's to give, and so do I.

## 9. Locked decisions

Everything in v1 §3, v2 §8, v3 §6, v4 §5, v5 §6, v6 §9 and v7's numbered list
(36–42) still stands. Added:

43. **The site's own fonts live in `assets/fonts/`, shared between
    `index.html` and `404.html`, not duplicated per page.** Locked decision
    #17 ("each project vendors its own copy; nothing shared across
    projects") is a parallel-safety rule for twenty threads that can't see
    each other's work — it doesn't apply here, because `index.html` and
    `404.html` aren't a project, they're the site, and they're both owned by
    the one thread that can safely share a folder between them. See
    `assets/fonts/README.md`.
44. **`page.__blocked` is "offsite and refused"; `page.__shimmed` is
    "offsite and fulfilled locally instead."** A page can report an empty
    `__blocked` and still hotlink Google Fonts, because `harness.mjs`'s font
    shim answers the request before the blocked-list check ever sees it.
    Checking `__blocked` alone answered "did we see this happen" instead of
    "did the page ask" for the site's entire history until this session.
    `check-integrity.mjs`'s static source sweep is the check that actually
    scales past what a browser suite happens to drive.
45. **Faire Weekend: a day is final once the gates close.** Persisting a
    report and locking it against replay are the same action, not two
    design choices — `runDay()` already applies its results the instant the
    button is clicked, so the only reason a reload used to undo a day was
    that the result never reached disk. Reloading mid-report now keeps the
    day rather than rewinding to before the gates opened.
46. **A tool's own version lives in the page, not the filename.** Schedule
    Browser and Schedule Visualizer were both suffixed with a date or a
    version number, which meant every republish was a board `href` edit —
    a cross-thread request under the twenty-way split. `TOOL_VERSION` is now
    a constant shown in the header and stamped into every file the tool
    publishes; the board `href`s are the plain, permanent names
    (`Tools/schedule-browser.html`, `Tools/schedule-visualizer.html`), and
    the old dated paths stay as tiny redirect stubs so nothing already
    linked or bookmarked 404s.
47. **`gvb-save.js`'s `fresh`/`reset` forward arguments to a `defaults`
    factory, and `clear()` erases without invoking one.** Added because a
    second and third adopter's day-one state depends on a runtime choice
    (which brokerage) rather than only randomness, and because building and
    immediately discarding a fresh state just to reach `clear the key` was
    real, if harmless, waste. See §4.
48. **`gvb-save.js`'s `mountSaveBar` takes `filename` and `labels`
    overrides, and its import handler calls `setState` before writing to
    storage, vetoable by returning `false`.** Three adopters independently
    needed to rename the export file or the buttons to fit their own
    vocabulary rather than a game's; one needed to stop an import from
    overwriting a good save with a rejected one. See §4.
49. **Two storage-construction gaps in `gvb-save.js`, both in the exact
    scenario the memory fallback exists to survive:** `typeof localStorage`
    itself can throw in a browser that blocks storage (it's a declared
    accessor, not an undeclared identifier), and `load()`'s `getItem` call
    was unguarded. Both fixed; both would have taken a page down in a
    private-mode or storage-blocked browser before this session. See §4.
50. **`repair` also covers content drift, not just schema drift.** A
    data-driven game whose save holds one entry per content file will meet
    saves written before some of that content existed — that's not a
    version problem, `repair` runs on every accepted load regardless of
    version for exactly this reason, and it is the right hook for it without
    being bent to fit.

## 10. Suggested next session

Roughly in order of value per effort:

1. **Torchbearer's preview.** Play the nine-step builder once in a real
   browser, export the hero, commit the file, then the recipe and the
   `play-games.mjs` beats are both already written out in Torchbearer's own
   notes file — transcription, not design.
2. **Invert the one expected-failing test each in Corner & Kettle's and
   Seating Chart's own suites** (§4, §8). One line each.
3. **Decide the committed schedule-data question** (top of this file).
   Five minutes of judgement; nobody else can make this call.
4. **Decide whether the grading-arithmetic correction needs to go anywhere
   else** (top of this file) — if the old tool was used on a real report
   card in the x.45–x.4999 band at a boundary, that grade was wrong.
5. **`Pathfinder/data/` as a shared interface or not** (§8). Blocks the
   largest possible version of at least two other projects; cheaper to
   decide now than after someone builds against an unstable shape.
6. Everything else in each of the twenty projects' own notes files under
   their own "Next session" — unchanged by this thread, carried forward
   there rather than duplicated here.

---

## Verified this session

- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed** (was 39)
- `cd Tools/board-check && npm run check` → **329 units checked, 0 broken; 0
  collisions across nine widths, tightest gap 7.1px**
- `npm run social:check` → **22 notices, 22 already current** (was 23; see §1)
- `npm run games` → **126 checks, 0 failed**, all six non-Castle games (94 →
  122 after the new beats, → 126 once Faire Weekend's report-phase beats
  landed clean on the second pass)
- `npm run tools` → **18 checks, 0 failed** (new)
- `npm run previews absalom-inheritance/daredevil/fracture-cycle/corner-and-kettle`
  → all four reached gameplay, 0 failed, after one fix (Daredevil's Continue
  count). `npm run previews castle-conundrum` and `golden-hour` (recapture)
  → both reached gameplay, 0 failed
- `npm run promote` → **all 11 preview/OG pairs written**, 6.3–14.2 KB per
  preview (60 KB ceiling), 32.6–103.2 KB per OG card (300 KB ceiling)
- `npm run play` → Castle Conundrum, unchanged by this thread (owned by
  prompt 05, which recaptured its preview this round — see §6)
- Every adopter's own Node suite for the `gvb-save.js` changes: Fourth
  Quarter (189), Aphelion (23), Torchbearer (86), Absalom Inheritance (244),
  Daredevil (53), Integer Foundry (90), Fracture Cycle (26), Name Picker
  (207) all clean; Corner & Kettle (161 of 162) and Seating Chart (122 of
  123) each report one expected failure (§4, §8)
- Locked decision #34, twice: the offsite static sweep (§2) and the
  construction-time `typeof localStorage` throw (§4), each broken on
  purpose, watched fail, restored, watched pass
