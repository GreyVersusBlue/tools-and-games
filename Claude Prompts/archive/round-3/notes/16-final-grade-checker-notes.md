# Final Grade Checker — session notes

## Is the arithmetic right

**No, and this round's fix is bigger than round 2's.** Both "Questions for Devon" from the prompt got answered directly this session, and the second answer changed the scope of the fix.

Question 1 (does any past report card need a second look): Devon's answer — "that was a bug that existed before. A student should only get a letter grade if they earn the FULL quality point. It is rare for a student to get the score average and not the quality point, but does happen in edge cases." That's about the general rule, not a yes/no on specific report cards, so I'm not marking it closed. See "Next session."

Question 2 (are the 3.5/2.5/1.5/0.5 thresholds right): Devon's answer — "No, it should be 4-a, 3-b, 2-c, 1-d, 0-f." This is a bigger correction than round 2 shipped, not a refinement of it.

Round 2 fixed the .5 boundary to be asymmetric with the percentage side (3.50 stays a B) but kept the thresholds themselves at the midpoints — 3.5, 2.5, 1.5, 0.5. That was still wrong. The real rule isn't "clear the midpoint," it's "earn the whole point." The cutoffs are the integers themselves — 4, 3, 2, 1 — compared with `>=`, not `>` against a `.5` below them.

The practical difference: almost every fractional QP average that wasn't sitting exactly on a `.5` was landing one full letter too high under both round 1 and round 2's code. Worked out against the full 0.25-step table (all 17 reachable QP averages, since four integers 0-4 averaged over 4 quarters only land on multiples of 0.25):

    old code (>midpoint)      new code (>=whole number)
    4.00 -> A                 4.00 -> A     (unchanged, exact 4)
    3.75 -> A  (WRONG)        3.75 -> B
    3.50 -> B                 3.50 -> B     (unchanged, exact .5 boundary)
    3.25 -> B                 3.25 -> B     (unchanged)
    3.00 -> B                 3.00 -> B     (unchanged, exact whole number)
    2.75 -> B  (WRONG)        2.75 -> C
    2.50 -> C                 2.50 -> C     (unchanged)
    2.25 -> C                 2.25 -> C     (unchanged)
    2.00 -> C                 2.00 -> C     (unchanged)
    1.75 -> C  (WRONG)        1.75 -> D
    1.50 -> D                 1.50 -> D     (unchanged)
    1.25 -> D                 1.25 -> D     (unchanged)
    1.00 -> D                 1.00 -> D     (unchanged, exact whole number)
    0.75 -> D  (WRONG)        0.75 -> F     (the pass/fail line)
    0.50 -> F                 0.50 -> F     (unchanged)
    0.25 -> F                 0.25 -> F     (unchanged)
    0.00 -> F                 0.00 -> F     (unchanged)

Every `x.75` average was one full letter too high under the old code. `x.00`, `x.25`, and `x.50` averages were already correct (the whole numbers and the .5 boundary happen to fall in the same place either way), so the wrongness was specifically the `x.75` band and nowhere else in the table. That's still 4 of the 17 reachable values, and `.75` is not a rare landing spot: it's what you get from any four-quarter set with one more A-quality quarter than B-quality, or one more B-quality than C-quality, and so on.

Worked examples, hand-computed and then confirmed live in the browser (see "What I verified"):

    Q1 90 A=4   Q2 90 A=4   Q3 90 A=4   Q4 10 F=0
    quality points   12/4 = 3.00 -> B  (a full 3, earned outright)
    percentage      280/4 = 70.00 -> C
    B beats C. Quality points wins for real — three strong A's outweigh one bad F.

    Q1 70 C=2   Q2 70 C=2   Q3 70 C=2   Q4 20 F=0
    quality points    6/4 = 1.50 -> D
    percentage      230/4 = 57.50 -> F
    D beats F. Quality points passes a student the percentage side fails outright.

    Q1 95 A=4   Q2 92 A=4   Q3 88 B=3   Q4 94 A=4
    quality points   15/4 = 3.75 -> B  (old code said A — this is the case that changed)
    percentage      369/4 = 92.25 -> A
    A beats B. This time it's the PERCENTAGE side that wins, not quality points — the
    opposite of what the old, wrong code would have shown (a false "tie", both A).

    Q1 60 D=1   Q2 60 D=1   Q3 60 D=1   Q4 30 F=0
    quality points    3/4 = 0.75 -> F  (old code said D and passed this student — wrong)
    percentage      210/4 = 52.50 -> F
    Fails by both methods. No rescue: three D's and an F don't add up to a full point.

    Q1 70 C=2   Q2 60 D=1   Q3 60 D=1   Q4 30 F=0
    quality points    4/4 = 1.00 -> D  (exactly the full point, earned)
    percentage      220/4 = 55.00 -> F
    D beats F. Swap one of the D's for a C and the student clears the line —
    the margin is exact, not approximate.

The fourth example is the one that matters most: it's a near-identical grade profile to the third (three low-mid quarters and one bad F) but landing on the opposite side of the line, because 0.75 doesn't reach a full 1.0 and 1.00 does. The old code would have called both of these D's. Only one of them actually is.

Rules 1, 2 and 3 (compute both figures, report the higher, ten-point scale) are unaffected — still right, still just plumbing around whichever number `qpToFinalLetter` produces. Missing/exempt quarters, paste import, and the percentage side (rule 4's other half, confirmed correct in round 2) are all unaffected by this round's change.

**What is still not settled after this round:** whether any real report card, at any point in this tool's history (not just the one-round window round 2 assumed), used the QP method's result while the average happened to land on an `x.75` boundary. That window is now bigger than round 2 thought, because the bug wasn't a narrow `.5`-boundary edge case, it was the entire `.75` band, present since this tool's dual-method calculation first went live. Not a code decision — see "Next session."

## What changed

**`Tools/final-grade-checker/grade-math.mjs`** (217 to 224 lines). `QP_CUTOFFS` changed from `[['A',3.5],['B',2.5],['C',1.5],['D',0.5]]` to `[['A',4],['B',3],['C',2],['D',1]]`. `qpToFinalLetter`'s comparison changed from `v > cutoff` back to `v >= cutoff` — not a revert to round 1's bug, a different comparison against different (correct) numbers. Comments at the top of the file, above `QP_CUTOFFS`, and above `qpToFinalLetter` rewritten to state the whole-point rule and explain why it's a bigger fix than round 2's, so the next person doesn't read the old "asymmetric at .5" framing and assume that was the whole story.

**`Tools/final-grade-checker/grade-math.test.mjs`** (303 to 335 lines, 130 to 139 assertions). Recomputed every QP-affected worked example against the new rule:

- The `qpToFinalLetter` lookup table (all 17 reachable averages): four rows changed (3.75, 2.75, 1.75, 0.75 each drop one letter).
- The "higher of the two wins" example: old A,A,C,D (2.75 QP) no longer demonstrates a QP win under the corrected rule (both methods tie at C now), replaced with A,A,A,F (90/90/90/10).
- The "QP wins near the pass/fail line" example: old three-C's-and-a-D (1.75 QP) same problem, replaced with three-C's-and-a-very-low-F (70/70/70/20).
- The "one quarter carries a student over the line" example: old F,D,D,D (0.75 QP, previously read as a passing D) is actually a failing student under the corrected rule. Replaced with a pair: D,D,D,F (0.75, fails both methods) versus C,D,D,F (1.00, quality points passes it) to show exactly where the line is and that it isn't where the old code drew it.
- The end-to-end pasted-class test: Gwendolyn's 3.75 QP average used to tie with her 92.25% (both read as A, "won" by QP). Under the real rule her QP is a B, so her A is actually a PCT win, not a tie. Same final letter on her report card, wrong method credited.
- Added a new dedicated group, "Quality points must earn the full point, not just clear a midpoint," mirroring how round 2 gave the `.5`-asymmetry finding its own group. Confirms `4.00` is the only input that produces an A, and that `3.99`, `3.75`, `2.75`, `1.75`, `0.75` are one full letter below where the pre-fix code placed them.
- Kept: all the exact-`.5` assertions (3.50→B, 2.50→C, 1.50→D, 0.50→F) and the A,A,D,D boundary example (2.50 QP → C), because those are unaffected by this round's fix — the `.5` boundary itself was already correct after round 2, only the fractional-but-not-`.5` values were wrong.

**`Tools/final_grade_checker.html`** (866 lines, no line count change — text edits only). Two spots:

1. The on-screen policy note now reads "This side must earn the **full** point for a letter — an average of 3.99 is still a B, not an A. Only an exact 4.00 is an A," replacing round 2's "does not round up at exactly .5 — an average of exactly 3.5 is a B" language, which was true but incomplete.
2. The PDF footer text updated the same way: "quality points must earn the full point (3.99 is still a B, not an A)," replacing "quality points do not (3.5 is a B)."

No HTML structure, CSS, or JS logic changed outside those two text strings — the arithmetic itself lives entirely in `grade-math.mjs`, which the page imports.

Vendored library total unchanged from round 2: 402,489 bytes (393 KB), still just jsPDF and jsPDF-AutoTable. No library changes this round.

## What I verified

```
node Tools/final-grade-checker/grade-math.test.mjs
  139 passed, 0 failed        (was 130)

Locked decision #34: reverted QP_CUTOFFS to [3.5,2.5,1.5,0.5] and the
comparison to `>`, reran the suite:
  12 FAILED, 127 passed
All 12 failures are exactly the assertions that depend on the whole-point
rule (the four changed qpTable rows, the new dedicated group's six
assertions, the two calcFinals-based line-clearing assertions, and the
Gwendolyn end-to-end case) — nothing else broke, confirming the fix is
load-bearing and scoped to what it should be. Restored the file, confirmed
byte-for-byte via sha256: b7cf7f26829db838133c77d37574749b20ba6897165770b8
2863b55b0b4c10ea before and after.

cd Tools/board-check && npm run tools
  18 checks, 0 failed         (Final Grade Checker's page: no offsite
  requests, no console errors, real title)

cd Tools/board-check && npm run check
  359 units checked, 0 broken, 0 collisions across nine widths,
  tightest vertical gap 9.1px

cd Tools/board-check && npm run social:check
  18 notices, 12 current, 6 pages out of sync — none of them this tool.
  See "Shared-file requests."
```

**In a real browser**, served over http on port 47681 via the `gvb-static-site` launch config.

- Page load and structure confirmed via `get_page_text` and `read_page`: the updated policy text ("must earn the full point... only an exact 4.00 is an A") renders correctly on the page.
- **All five worked examples above, typed into real input fields via the actual DOM (not by calling the JS functions directly), and read back from the actual result boxes:**
  - 90/90/90/10 → Quality Points avg 3.00 pts (B, ★ Use This), Pct. Average 70.00% (C), Final **B**, "by quality points."
  - 70/70/70/20 → Quality Points avg 1.50 pts (D, ★ Use This), Pct. Average 57.50% (F), Final **D**, "by quality points."
  - 95/92/88/94 → Quality Points avg 3.75 pts (B), Pct. Average 92.25% (A, ★ Use This), Final **A**, "by percentage average" — confirms the winner-attribution flip live, not just in the test file.
  - 60/60/60/30 → Quality Points avg 0.75 pts (F, ★ Use This), Pct. Average 52.50% (F), Final **F** — confirms no rescue when the QP average falls short of a full point.
  - 70/60/60/30 → Quality Points avg 1.00 pts (D, ★ Use This), Pct. Average 55.00% (F), Final **D** — confirms the exact boundary: one letter grade's difference in a single quarter (C vs. D) is the entire difference between failing and passing here.
  All five match the hand-worked math and the test suite exactly.
- **Exported a CSV for real.** Intercepted `URL.createObjectURL` to capture the actual `Blob`, read its raw bytes with `arrayBuffer()`. First three bytes `239, 187, 191` (the UTF-8 BOM), followed by the header row and all five students' data. Row 3 (Gwendolyn's case) shows `95,92,88,94,3.75,B,92.25,A,A,Pct. Average` in the raw export — the "Method Used" column correctly says "Pct. Average," not "Quality Points," confirming the winner-attribution fix survives all the way to the exported file, not just the on-screen display. 355 bytes total.
- **Exported a PDF for real.** Same capture technique: 20,249 bytes, `Content-Type: application/pdf`, `/Producer (jsPDF 2.5.1)` readable in the raw bytes, and the updated footer string ("must earn the full point") confirmed present in the raw PDF bytes via substring search, not just visually inferred. One `console.warn` fired: "Of the table content, 162 units width could not fit page" — the same pre-existing jsPDF-AutoTable warning noted in round 2, unaffected by this session's changes (see "Deliberately not done").
- 375×812: `documentElement.scrollWidth` 375, equals `clientWidth`, no horizontal overflow. No layout changed this session (text-only edits), so this is a no-regression check, not new coverage.

**Not verified: no screenshot, third round running.** Same error both previous rounds hit, verbatim: "the Browser pane is not displayed, so the page is not compositing frames." Tried after real user interaction (typed values, triggered exports) in case an idle pane was the cause — same failure. This is not a flaky, environment-dependent gap anymore; it's now failed identically in three separate sessions, which suggests it isn't going to resolve itself by retrying. See "Next session."

## Shared-file requests

None from `assets/js/gvb-save.js` — nothing to remember, unchanged from round 1's standing FERPA-based decision.

The `npm run social:check` drift (6 pages out of sync: `daredevil`, `torchbearer`, `fourth-quarter`, `Ren-Faire-Claude`, `orbital`, `newindex.html`) does not include this tool's page. Not filing a request; noting it only because it showed up in this round's verification run and previous rounds' notes flagged similar drift as someone else's problem. Still someone else's problem — none of those six files are mine, and `final_grade_checker.html` isn't in the drift list.

## Deliberately not done

**The jsPDF-AutoTable column-width warning.** Same as round 2: real, reproducible, pre-existing, outside this round's assigned scope. The export still produces a correct, readable PDF. Confirmed again this round via the same raw-byte capture; still just a `console.warn`, not a defect in the output.

**Checking specific old report cards for the `.75`-band bug.** Devon's answer confirmed the direction of the rule but didn't resolve whether any specific past report card needs re-checking, and that's not something I can determine from the code. Flagged prominently in "Next session" instead of guessed at.

**Building support for letter-only quarters.** Already closed by round 2 (Devon confirmed directly: never seen in practice). Not re-litigated.

## Next session

Ordered by value per effort.

1. **Decide what, if anything, needs checking on past report cards.** This is bigger than round 2's version of this question. Round 2 thought the risk window was one round, because it assumed the only bug was rounding at the `.5` boundary. It wasn't — the `.75` band was wrong too, and has been wrong since this tool's dual-method calculation first went live, not just for one round. Any student whose QP average landed on `x.75` (one more A-quality quarter than B-quality, or B-quality than C-quality, and so on) and whose QP method was the one reported, got a letter one grade too high, for the tool's entire history until this session. Not a code decision — needs Devon's read on whether real report cards were involved and what to do about it if so.
2. **Get an actual screenshot.** Three rounds in a row, identical failure each time ("the Browser pane is not displayed, so the page is not compositing frames"), including this round's attempt after real user interaction with the page. At this point it's worth trying from a session where the pane is actually displayed, rather than retrying the same approach a fourth time.
3. **The jsPDF-AutoTable column-width warning.** Still real, still reproducible, still cosmetic. Lowest value item on this list; the PDF is correct either way.
4. Everything from round 2's list that this round closed: the QP-rounding direction question (closed, this round revealed it needed a bigger fix than round 2's own answer), the exact QP threshold numbers (closed — Devon confirmed 4/3/2/1/0 directly, not 3.5/2.5/1.5/0.5). Nothing carried forward from those two.

**Is this tool in a stable, finished state? No — not yet, and it's a "not yet" outside the code, not inside it.**

The arithmetic itself is done. It's correct per Devon's direct confirmation, it's the most-tested part of this codebase (139 assertions, every QP-affected case hand-verified against a live DOM and a real exported CSV/PDF, the fix verified load-bearing by reintroducing the old bug and watching 12 assertions fail on cue), and nothing in this round's changes touched HTML structure, CSS, or the export pipeline beyond two text strings. If "stable" meant only "is the calculation right and covered," the answer would be yes.

But two things stop me from calling the tool itself closed:

1. **Item 1 under "Next session" is a real open question, not a formality.** Whether any actual report card was affected by the `.75`-band bug is something only Devon can answer, and it hasn't been answered yet — this session's answer to "does any report card need a second look" confirmed the rule but not the historical impact. Until that's resolved one way or the other, there's an open item that has nothing to do with whether the code is correct now.
2. **No screenshot, three rounds running, same failure verbatim each time.** That's no longer a one-off environment hiccup to retry past; it's a standing gap in this tool's verification history that a fourth identical attempt is unlikely to close.

Net: ship the code, it's right. Don't file this tool as fully closed until both of those get resolved by someone other than a repeat of this session's approach.
