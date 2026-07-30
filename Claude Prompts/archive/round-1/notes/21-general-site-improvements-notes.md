# General Site Improvements — session notes

All twenty other notes files existed when this session started, so this is a
full run: tasks one through six, not a partial pass.

## What changed

**Task one — the Bestiary Gallery is gone.** Deleted
`Tools/creature_artwork_gallery.html` and its notice from `index.html`'s
Pathfinder section. It made 3,894 requests to `2e.aonprd.com` — the site's
largest offsite dependency by three orders of magnitude, for its entire
history, unmeasured because no suite ever opened a Tools or Pathfinder page.
**Notice count: 22, down from 23.** `npm run social:check` confirms 22 of 22
current.

**Task two — the offsite-request measurement hole is closed.** Two
independent fixes:

- `Tools/board-check/harness.mjs`'s `prepPage()` now records every URL its
  font shim fulfils locally in a new `page.__shimmed` array, separate from
  `page.__blocked` (refused). The old docstring said the empty `allow` list
  "is what makes `page.__blocked` an honest inventory" — false, and now
  corrected in place. A font hotlink was never going to show up there; the
  shim answers it before the blocked-list check runs.
- `Tools/board-check/check-integrity.mjs` gained a static sweep: every
  `.html` in the repo, grepped for `<link>`/`<script>`/`<img>`/`<iframe>`/
  `<source>`/`<audio>`/`<video>`/`<embed>` tags and CSS `url()`s pointing
  offsite. No browser, and it covers pages nothing else ever opens — which is
  exactly how the gallery went unmeasured. `<a href>` is deliberately not one
  of the scanned tags; a navigation link isn't a request the page makes on
  its own.

Verified per locked decision #34: added a font hotlink back to `index.html`,
watched `npm run check` fail naming `fonts.googleapis.com`, removed it,
watched it pass again.

**Task three — `index.html` and `404.html`'s fonts are vendored.** Five
files, 106.8 KB, in new `assets/fonts/` (Alegreya 400 normal+italic, Alegreya
SC 400, Grenze Gotisch 500+700 — read from the CSS, not the hotlink, which
asked for two combinations neither page uses). `404.html`'s `@font-face` `src`
paths are root-absolute per locked decision #8; `index.html`'s are relative.
New locked decision #43 records why a shared `assets/fonts/` for the site's
own two pages is not a violation of #17 — see `assets/fonts/README.md`.

**Task four — 404 page and board review.**

- Confirmed `/#quests`, `/#pathfinder`, `/#services` all still resolve to
  real anchors in `index.html`.
- Tested `404.html` on a real deep subpath (served
  `/Projects/nonexistent-thing` off `harness.mjs`'s `serve()`): 404 status,
  themed page, both root-absolute links present and correct.
- Left `404.html`'s tags as they are — plain `<meta name="description">`,
  `noindex`, the shared favicon, no OG/Twitter block. It is not one of the 22
  notices and has no business being shared as a link preview; "deliberately
  bare" is the answer, written down as asked.
- Confirmed the archived Fourth Quarter card is untouched: `class="archived"`,
  "OLD NOTICE — STILL PINNED", points at `Projects/The-Fourth-Quarter.html`.
- Reviewed the five preview-less cards (Absalom Inheritance, Corner & Kettle,
  Daredevil, Torchbearer, The Fracture Cycle). Four now have `games.mjs`
  recipes and captured previews (see below); Torchbearer is deliberately not
  done this session — see Deliberately not done.

**Task five — shared-file requests.** Detailed request-by-request below. In
one paragraph: reconciled and applied five real gaps in `gvb-save.js` found by
four different adopters this round (a construction-time throw, an unguarded
`load()`, `fresh`/`reset` not forwarding arguments, no way to just erase, and
`mountSaveBar` unable to rename its export file or its buttons), added a
`Tools/` sweep (`tools.mjs`) that closes the same "nothing opens this page"
hole `check-integrity.mjs`'s static sweep closes for offsite hosts, added and
tested new `play-games.mjs` beats for six of the seven games, added
`games.mjs` recipes and captured previews for four of the five games missing
them, and applied both board `href` fixes from prompt 19.

**Task six — version bumped to 9, `gvb-site-handoff-v8.md` written.**

## What I verified

Commands and actual output, in the order the tasks above were done.

```
cd Tools/board-check && npm run check
  329 units checked, 0 broken
  0 collisions across nine widths, tightest gap 7.1px

npm run social:check
  22 notices · 22 already current · 0 out of date · 0 failed

node assets/js/gvb-save.test.mjs
  50 passed, 0 failed   (was 39)

npm run games
  126 checks, 0 failed   (was 94 before this session's beats;
                          122 after the first pass, 126 once
                          Faire Weekend's fix landed)

npm run tools
  18 checks, 0 failed   (new script)

npm run previews absalom-inheritance
npm run previews daredevil          (needed a fix — see below)
npm run previews fracture-cycle
npm run previews corner-and-kettle
npm run previews castle-conundrum   (recapture)
npm run previews golden-hour        (recapture)
  all six reached gameplay, 0 failed

npm run promote
  11 preview/OG pairs written, 6.3-14.2 KB per preview (60 KB ceiling),
  32.6-103.2 KB per OG card (300 KB ceiling)
```

**Locked decision #34, twice.** Reintroduced a `fonts.googleapis.com`
`<link>` into `index.html`, ran `npm run check`, watched it fail
(`references offsite host(s): fonts.googleapis.com`), removed it, watched it
pass. Reverted the `gvb-save.js` construction-time guard to its old form
(`storage || (typeof localStorage !== "undefined" ? defaultStorage() : null)`),
ran the test suite, watched 3 of the new tests fail with the exact
`SecurityError` the fix exists to prevent, restored the fix, watched all 50
pass again.

**The Daredevil preview capture needed a live fix.** My first `play()`
recipe budgeted 6 Continue-clicks to reach the origin-choice screen, copying
the shape of the shared-file request without re-measuring it. It aborted at
"Cold Open · Panel 2." Measured by hand: the actual distance is 14 clicks.
Widened to 20 with margin; the second run landed clean on "THE MOMENT."

**Ran every `gvb-save.js` adopter's own Node suite** after the module
changes, not just the module's own tests, since eleven projects now depend
on it: Fourth Quarter 189/189, Aphelion 23/23, Torchbearer 86/86, Absalom
Inheritance 244/244, Daredevil 53/53, Integer Foundry 90/90, Fracture Cycle
26/26, Name Picker 207/207 — all clean. Corner & Kettle 161/162 and Seating
Chart 122/123 each report one failure, and both are expected: each project
wrote a test asserting the *old* buggy behavior specifically so it would
fail once fixed. It's fixed. Not something I can correct myself — those test
files belong to those projects.

## Requests applied, and requests refused

Every request from every notes file, and what happened to it.

### `assets/js/gvb-save.js` — applied

Four sessions independently found real gaps. Reconciled rather than bolted on
separately, per the prompt's instruction to read Closing Time and Name Picker
first if three threads ask for the same shape of thing — here it was five
different gaps from four different threads, no two identical, so all five
landed as five small, independent, backward-compatible changes:

1. **Construction-time throw** (Corner & Kettle request 2, Seating Chart
   request 1, identical diagnosis from both): `typeof localStorage` itself
   throws in a browser blocking storage, before `defaultStorage()`'s own
   `try/catch` runs. `createSaveSlot()` now wraps that check too. Verified by
   reintroducing the bug and watching the new test fail (locked decision #34).
2. **`load()`'s unguarded `getItem`** (Corner & Kettle request 1, Name Picker
   request 1, identical): wrapped in `try/catch`, matching `save()`'s
   existing shape.
3. **`fresh(...args)`/`reset(...args)`** (Closing Time request 1): forward
   arguments to a `defaults` factory, for a game whose day one depends on a
   choice the module doesn't know about (which brokerage), not just on
   randomness.
4. **`clear()`** (Closing Time request 2): erase the key without building and
   discarding a fresh state first. `reset()` is now `clear()` then `fresh()`.
5. **`mountSaveBar`'s `filename` and `labels` options** (Torchbearer requests
   1 and 2, Name Picker request 2, Seating Chart request 2 — four requests,
   two shapes): `filename` overrides the export button's download name
   (Torchbearer names exports after the hero; Name Picker wanted
   `name-picker-roster-backup-…` instead of `name-picker-save-…`). `labels`
   overrides any button's text and title (Seating Chart's "Save to file" /
   "Open file" / "Erase saved data"). Also reordered the import handler to
   call `setState` before `slot.save()`, vetoable by returning `false`
   (Torchbearer request 2) — a host that rejects an import should not have
   already overwritten what was on disk.

All five are additive and backward compatible: every existing call site keeps
working unchanged. `node assets/js/gvb-save.test.mjs` grew from 39 to 50
assertions, all passing, plus each new fix verified failing first (locked
decision #34).

**Ran every adopter's own Node suite afterward** (eleven projects; see the
handoff for the full list). Two report one failure each, both expected and
both by design, not a regression: Corner & Kettle's `smoke-save.mjs` and
Seating Chart's `smoke-seating.mjs` each wrote a test that asserts the
*old*, buggy behavior specifically so it would fail loudly once the module
was fixed — their own words: "it will fail loudly and want inverting when the
fix lands." It landed. **Both projects' next session should invert or delete
that one assertion each** — not something I can do myself, since their test
files aren't mine to edit.

**Not applied:** Closing Time's `mountSaveBar` `canExport` idea (request 3) —
they said themselves "I would not change the module for it alone," and
nothing else asked for it. Name Picker's `box: true` option idea — explicitly
not requested yet, "one data point."

### `assets/js/README.md` — applied

Added the content-drift paragraph to the `migrate` vs `repair` section
(Closing Time), documented `filename`/`labels`/the import-order change,
rewrote "Who uses it" as a table covering all eleven current adopters (it
only named one), and added a note about the "a slot can't hold an array or a
bare scalar" limitation Name Picker's `boxed()` works around.

### `Tools/board-check/harness.mjs` and `check-integrity.mjs` — applied

`page.__shimmed` (Seating Chart request 3, Faire Weekend request 2's
docstring ask) and the static offsite sweep are task two, above — every
project that asked for a version of "measure what the font shim hides" got
the same fix once, at the level that actually scales.

### `Tools/board-check/play-games.mjs` — applied, six of seven games

- **Integer Foundry** (request 1, "the one that matters"): removed the
  seed-and-disarm workaround entirely. Every order is now guaranteed
  buildable on the floor the player has, so the suite reads the sink's actual
  target and builds a line that delivers it — no seeding, no luck. Tested
  live against the real page (had to add one line beyond what was
  suggested: erase the suite's own earlier demo line before reading the
  fresh target, since the request's block assumed an empty grid).
- **Aphelion** (request): save-bar mount/export beats. Applied verbatim,
  passed first run.
- **Golden Hour** (request): props/arrow-key/sun-descent beats. Applied
  verbatim, passed first run.
- **Faire Weekend** (request): tightened the now-stale comment about reports
  never reaching disk, added the mid-report save/reload beats. Required one
  fix beyond the request: `games.mjs`'s `open()` only ever waited for
  `.grounds-map`, which doesn't exist while a report is showing — a report
  reaching disk is this session's whole point, so a reload can now
  legitimately resume on one. Widened the wait to `.grounds-map, .ticket-stub`.
- **Closing Time** (request): version stamp, footer save bar, export,
  import, corrupt-save, and legacy-save beats. Adapted rather than pasted
  verbatim — needed a modal-dismissal helper the request's sketch didn't
  account for (a random event can leave a modal open across the reload) and
  a real DOM-redraw assertion in place of a placeholder I'd first written
  too loosely. Passed clean after both fixes.
- **The Fourth Quarter** (request): door-panel and box-score save-bar beats.
  Adapted: the request's skip-to-box-score sequence assumed the dev menu's
  skip button works before the doors open; it only works once a night is
  actually running, so opening the doors moved earlier. Also `#wipeBtn` only
  exists on the start overlay, reached by a reload, not by clicking it
  mid-campaign — fixed to reload first. 36 checks, passing.
- **Torchbearer** (request 5, "no entry for Torchbearer"): not applied — see
  Deliberately not done.

`npm run games`: **126 checks, 0 failed**, all six games, after the
`games.mjs` fix above (first full run caught the one real gap; second run
clean).

### `Tools/board-check/games.mjs` and preview captures — applied, four of five

New recipes for **The Absalom Inheritance**, **Daredevil**, **Corner &
Kettle**, and **The Fracture Cycle** — all four requests, applied close to
as-written. Captured, reviewed, and promoted all four (plus recaptured
Castle Conundrum and Golden Hour, whose own sessions changed what the game
looks like enough that the promoted card was showing something that no
longer exists). See the handoff for exact numbers.

**Torchbearer's recipe — not built this session.** Its own request is
explicit that this needs a prebuilt `.torchsave.json` committed under
`Projects/torchbearer/test/`, generated by actually playing the nine-step
builder, and says "the recipe is prompt 21's call... say the word and I will
add it." Building one blind — without playing the builder for real — risks
committing an invalid save that fails validation the first time anyone reads
it, which is a worse outcome than no preview. **Refused for this session,
flagged for next** (see Next session).

### `promote-previews.mjs` — applied, and a bug fixed in passing

The four new preview names needed adding to `KNOWN`, a hardcoded allowlist
the script uses to reject typos. Without this, `npm run promote` would have
silently refused every one of the four new games with "not preview names the
board asks for" — not something any of the four requesting sessions could
have caught, since none of them could run `promote-previews.mjs` (it isn't
theirs).

### `Tools/board-check/tools.mjs` — new, applied

Final Grade Checker's request 1: a sweep of the six Tools pages, headless,
asserting a non-empty title, no offsite requests, and no console errors.
`npm run tools`: **18 checks, 0 failed**. Wired into `package.json` and
documented in `README.md`.

### `index.html` — applied

- Bestiary Gallery notice removed (task one).
- Both Schedule href fixes (prompt 19 requests 1–2), pointing at
  `Tools/schedule-browser.html` and `Tools/schedule-visualizer.html` instead
  of the old spaced/dated filenames (both still resolve as redirect stubs,
  so this was a cleanliness fix, not a break-fix).
- Final Grade Checker's suggested description change (prompt 16, marked
  optional — applied since I was already touching Town Services for the
  schedule hrefs).
- Four `data-preview` attributes added, for the four newly-captured games.
- Version bumped 8 → 9 (task six).

`npm run social` re-run after each of the above; `npm run social:check`
reports 22 of 22 current.

### No shared-file request — confirmed, not applied

Anathema Archive, Pathfinder Campaigns (recommendation only, not a request),
Pathfinder Characters (recommendation only), Image to PDF: none had a
shared-file request. Golden Hour's "nothing needed in `games.mjs`" and
Faire Weekend's "no gvb-save.js gap" and similar explicit non-requests from
other threads are noted as confirmed, not re-litigated.

## Deliberately not done

**Torchbearer's preview and OG card, and its `npm run games` entry.** Both
need a prebuilt save file this session did not generate — see above. Next
session's cheapest path: play the builder once in a real browser, export the
hero, commit the file under `Projects/torchbearer/test/`, then the recipe and
the beats are both transcription of what Torchbearer's own notes already
wrote out.

**`Pathfinder/data/` as a shared interface.** Three separate sessions
(Torchbearer, The Absalom Inheritance) raised the same question — is it a
published interface or private to prompts 01–03 — and both correctly treated
it as a decision for Devon, not a code change. Not mine to resolve either;
noted in the handoff's next-session list.

**The `characters.html`/`campaigns.html` shared-CSS merge**, and **the
`Faire Weekend` mobile tap-target pass**, and other purely single-project
backlog items from the twenty notes files. Not shared-file requests, not
mine to act on — they stay in each project's own backlog, which the handoff
carries forward.

## Next session

Ordered by value per effort:

1. **Torchbearer's preview** (above). Small once someone is willing to play
   the builder once.
2. **Corner & Kettle's and Seating Chart's one expected test failure each.**
   Both are the gvb-save.js gap they documented, now fixed; each needs one
   assertion inverted or deleted in that project's own test file.
3. Everything else each of the twenty projects flagged in its own "Next
   session" section — unchanged by this session, carried forward in the
   handoff's backlog table.
