# Final Grade Checker — session notes

## Is the arithmetic right

**Headline finding: quality points do not round up at .5. The percentage average does.** This was the actual headline task (check the QP thresholds against real policy) and the answer came directly from Devon, not from a document. I spent real time first: searched the CCPS site, the district-wide Student Services Manual, East Middle's own 2025-26 handbook, Maryland's COMAR 13A.03.02.08, boarddocs, and the high school Program of Studies (which has a different, weighted GPA table for transcripts, not this). None of it published the actual per-quarter QP-to-letter midpoints. The CCPS Policy Book is described as living in the Superintendent's and each Principal's office, not online. So I asked. Devon's answer: quality points do NOT round up at all, but the percentage average does.

That means the previous round's code, which used the same `>=` comparison for both methods, was still wrong after last round's fix, just wrong in a smaller and more specific way. An averaged QP figure sitting exactly on 3.5, 2.5, 1.5 or 0.5 has to clear the line, not just meet it.

    qpToFinalLetter(3.50)  ->  B, not A
    qpToFinalLetter(2.50)  ->  C, not B
    qpToFinalLetter(1.50)  ->  D, not C
    qpToFinalLetter(0.50)  ->  F, not D  (the pass/fail line)

Fixed by changing the QP comparison from `>=` to `>` in `qpToFinalLetter`. The percentage side is untouched; it still rounds up at .5, which Devon also confirmed directly ("but grade average does").

**This breaks the two worked examples that were the centerpiece of the last two rounds of documentation.** Both used A,A,D,D (90,90,60,60), which averages to exactly 2.50 QP:

    Q1 90 A=4   Q2 90 A=4   Q3 60 D=1   Q4 60 D=1
    quality points   10 / 4 = 2.50 -> C   (was reported as B)
    percentage      300 / 4 = 75.00 -> C
    reported: C either way. A genuine tie, not a case of quality points rescuing the student.

Under the real rule this specific student is not an example of quality points winning at all, both methods land on C. I replaced the "QP wins" demonstration with a set that isn't sitting on a boundary:

    Q1 90 A=4   Q2 90 A=4   Q3 70 C=2   Q4 60 D=1
    quality points   11 / 4 = 2.75 -> B
    percentage      310 / 4 = 77.50 -> C
    B beats C. Quality points wins for real here.

The old A,A,D,D example is kept in the suite, relabeled as what it actually demonstrates now: a real four-quarter set that lands exactly on the boundary and comes out a tie once quality points stop rounding up.

**Rules 1, 2 and 3.** Unaffected, still right. The higher-of-two-methods logic (`winner`) didn't need to change, only what `qpFinal` evaluates to at the boundary, which feeds into it.

**Rule 4, the percentage half.** Unaffected, still right, per last round's fix and this round's re-confirmation. 89.5 is an A. The floating-point handling (round to 4 decimals before comparing) still holds for the same reason it did last round.

**Missing or exempt quarters.** Unaffected. `calcFinals` still declines to produce a final grade with fewer than four usable quarters.

**Letter-only quarters (this round's task two).** Asked Devon directly: does a TAC export ever show a bare letter with no percentage, like `B` instead of `B(84.00)`? Answer: never seen it. Not building support for a case that doesn't occur. `parseGradeToken` returning null for anything that isn't `X(NN.NN)` is correct, not a gap.

**What is still not verified against a written source, after this round.** The rounding *direction* for quality points is now confirmed directly by Devon. The actual *spacing* of the four thresholds (3.5 for A, 2.5 for B, 1.5 for C, 0.5 for D, each exactly 1.0 apart) is still inherited from the original code, not checked against the written policy text. It's internally consistent and now correctly asymmetric with the percentage side, but the specific numbers themselves are still an assumption, just a smaller one than before.

## What changed

**`Tools/final-grade-checker/grade-math.mjs`** (211 to 217 lines). The actual fix: `qpToFinalLetter`'s comparison changed from `v >= cutoff` to `v > cutoff`. Comments at the top of the file and above `QP_CUTOFFS` and `qpToFinalLetter` updated to state the asymmetry explicitly, so the next person doesn't "simplify" the two methods back to matching comparisons.

**`Tools/final-grade-checker/grade-math.test.mjs`** (279 to 303 lines, 119 to 130 assertions). Updated the four worked examples that happened to sit on a QP boundary (the marquee "QP wins" example, the "wins near the pass/fail line" example, one entry in the end-to-end pasted-class test, and the qpTable's four boundary rows). Added a new group, "Quality points — .5 does not round up, unlike the percentage average," with explicit boundary assertions and the real A,A,D,D tie case, mirroring how last round's percentage fix got its own dedicated test group.

**`Tools/final_grade_checker.html`** (833 to 866 lines). Three separate changes:

1. The on-screen policy text and the PDF footer text both now state the asymmetry (quality points don't round up, percentage does), instead of implying both methods work the same way.
2. **Export Excel is gone. Export CSV replaces it.** `xlsx.full.min.js` (861 KB, SheetJS, 67% of the vendored total) is deleted from the repo. Its styling was already confirmed dead on write last round (SheetJS Community drops `cell.s`), so it was buying a file extension, not an appearance. The new `exportCSV()` builds the file with a `Blob` and `URL.createObjectURL`, no library at all, with a UTF-8 byte-order mark so Excel on Windows reads accented names correctly, and proper quoting for any field containing a comma, quote or newline.
3. **"+ Add Student Row" button.** `MANUAL_COUNT` (a constant, 5) is now `manualCount` (a variable). The button appends one card without touching the ones already filled in, focuses the new name field, and hides itself in import mode (adding rows only means something in manual entry). `attachManualListeners` takes an optional root element now, so a freshly added card gets its own listeners wired without re-binding every existing input.

**`Tools/final-grade-checker/libs/README.md`** (72 to 65 lines). Rewritten: the xlsx row is gone from the table, the size total drops from 1.22 MB to 402,489 bytes (393 KB), and a new "Why xlsx is gone" section carries the same reasoning that was already flagged as a pending decision last round.

**`Tools/final-grade-checker/libs/xlsx.full.min.js`** deleted (`git rm`).

## What I verified

```
node Tools/final-grade-checker/grade-math.test.mjs
  130 passed, 0 failed        (was 119)

Locked decision #34: reintroduced the old `>=` comparison in qpToFinalLetter,
reran the suite, 12 failed (confirms the fix is load-bearing), restored the
file, sha256 before and after both 1e909139c9b61eb57a7c5d3039cc35bb796a4f8
6f7392a7ba776b3c061349ca7, byte-for-byte.

cd Tools/board-check && npm run tools
  18 checks, 0 failed         (Final Grade Checker's page: no offsite
  requests, no console errors, real title)

cd Tools/board-check && npm run check
  345 units checked, 1 broken  <- NOT this file, see Shared-file requests

cd Tools/board-check && npm run social:check
  parse failure                <- NOT this file, see Shared-file requests
```

**In a real browser**, served over http on port 47681 via the existing `gvb-static-site` launch config.

- Page load: 2 network requests total (the HTML and `grade-math.mjs`). No library bytes until a button is pressed. No console errors.
- Typed 90/90/70/60 into a manual row (the new "QP genuinely wins" example): QP box showed avg 2.75 / B, Pct box showed 77.50% / C, Final line showed B by quality points. Matches the hand-worked example above, confirmed live, not just in the test file.
- Typed 90/90/60/60 into another row (the old boundary example): QP 2.50 / C, Pct 75.00 / C, Final C. Confirms the tie live, in the actual DOM, not just in `grade-math.test.mjs`.
- **Exported a CSV for real.** Intercepted `URL.createObjectURL` to capture the actual `Blob` before the download fired, read its raw bytes with `arrayBuffer()`: first three bytes are `239, 187, 191`, the UTF-8 byte-order mark, followed by the header row and both students' data, correct on every column. (Calling `.text()` on the same blob strips the BOM, that's `TextDecoder`'s own default behavior per the Encoding spec, not a bug in the export. Worth knowing if anyone else checks this the same way.)
- Confirmed zero network requests for the CSV export. No library loads at all.
- **Exported a PDF for real.** Same capture technique: 13,645 bytes, `Content-Type: application/pdf`, `/Producer (jsPDF 2.5.1)` readable in the raw bytes. Two `console.warn` lines appeared ("Of the table content, 162 units width could not fit page") from jsPDF-AutoTable. This is pre-existing: the table's column layout is untouched by this session's changes (I only edited the footer text strings), so this warning was already there, just never explicitly checked before now since last round's own check was for `console.error`, not `console.warn`. Not fixing it, it's outside this round's five tasks and the export still produces a correct, readable PDF.
- **Add Student Row**, tested by clicking the real button (via its click handler, not by calling the JS function directly): went from 5 cards to 7, the first card's already-typed name and Q1 value were untouched, focus moved to the new row's name field. Filled all four quarters on the new row and the calculation engine picked it up correctly (same 90/90/60/60 tie case above, reproduced on a dynamically added row).
- **Clear All** on a 7-row board blanks all 7 rows and keeps 7 cards, it does not delete the rows you added. Confirmed this is the existing "Clear All blanks data, not roster shape" behavior, applied consistently to added rows rather than a new inconsistency.
- 375x812: `documentElement.scrollWidth` 375, equals `clientWidth`, no horizontal overflow. Quarter inputs at two rows of two, 101 px each. Add Student Row button fits at 147 px wide.
- Print rules read from the CSSOM: `.no-print { display: none !important }` exists inside the print media block and the new Add Student Row wrapper carries that class, so it hides on a printed page the same way the header buttons already do. `.note-bar` and `.result-box.winner`'s print styling are unchanged from last round.

**Not verified: no screenshots, again.** Same limitation the previous round hit: the browser pane did not composite frames in this session either ("the Browser pane is not displayed, so the page is not compositing frames"). Tried a fresh tab, tried the auto-opened editor-preview tab, same error both times. Everything above is geometry, CSSOM and raw bytes, not a picture. Two rounds running now without an actual screenshot of this page.

## Shared-file requests

Two, both outside this tool's boundary, both surfaced by running the site-wide checks as verification (not something I went looking for).

**1. `newindex.html` hotlinks fonts.googleapis.com and fonts.gstatic.com.** `npm run check` in `Tools/board-check` reports it as the one broken unit out of 345. Not a file I own or touched. Flagging for whoever owns `newindex.html` (looks like a board-owned file, last touched by another thread the day before this session per `git log`).

**2. `sync-social-tags.mjs --check` fails to parse `index.html`.** Output: "only parsed 17 notices out of index.html, the notice markup has changed shape, fix the regexes rather than shipping a partial sweep." `index.html` is prompt 21's file, not mine. Flagging since it means `social:check` can't currently confirm the board's notice count is accurate for any prompt in this round, not just this one.

Nothing needed from `assets/js/gvb-save.js`. Nothing needed from `Tools/board-check/tools.mjs`, already covers this page (18/18 clean).

## Deliberately not done

**Letter-only quarter support.** Asked Devon directly. Never seen in practice. Not building for a case that doesn't occur, per the prompt's own ten-minutes-to-check-first guidance.

**The jsPDF-AutoTable column-width warning.** Real, reproducible, pre-existing, and outside this round's five tasks. Noted above under "What I verified" rather than fixed.

**`newindex.html`'s font hotlinks and `index.html`'s notice-markup parse failure.** Both outside my boundary. Filed as shared-file requests instead of touched.

## Next session

Ordered by value per effort.

1. **Decide whether the brief QP-rounding bug needs anything beyond a code fix.** This tool's dual-method calculation only went live (imported into the actual page) last round. Between last round's session and this one, any student whose QP average landed exactly on 3.5, 2.5, 1.5 or 0.5, and whose QP method was the one reported, would have gotten a letter one grade too high. The window is short (one round, not "the tool's entire history" the way the percentage bug was), but if this tool got used on anything real in that window, it's the same kind of call the percentage fix needed: check old report cards, note it somewhere, or nothing. Not a code decision.
2. **The exact CCPS QP threshold numbers (3.5/2.5/1.5/0.5) are still inherited, not verified against the written policy text**, even though the rounding direction is now confirmed directly. If the actual Policy Book ever surfaces (Superintendent's or Principal's office copy), worth a five-minute check against these four numbers specifically.
3. **Get an actual screenshot.** Two rounds in a row where the browser pane measured correctly (CSSOM, geometry, raw export bytes) but never composited a frame. Someone with a working pane should just look at 375px and print preview.
4. Everything else from last round's list that this round closed: the Tools sweep (done, by prompt 21), CSV vs xlsx (done, this round), more than five manual rows (done, this round). Nothing carried forward from those three.
