# Final Grade Checker — session notes

## Is the arithmetic right

Two of the four rules were right. One was wrong by half a percent at every letter
boundary. And the paste importer could hand the arithmetic a quarter grade the
student never had, which is worse than any of it. Both wrong things are fixed and
both now have failing-first tests.

No real student data was in the file. Nothing to remove.

**Rule 1, both figures get computed.** Right, before and after.

**Rule 2, the higher of the two gets reported.** Right, before and after. This is
the one the prompt said to check first and it was the one thing the tool already
did correctly. `winner` compares letter ranks and a tie goes to quality points,
which is the same letter either way.

    Q1 90 A=4   Q2 90 A=4   Q3 60 D=1   Q4 60 D=1
    quality points   10 / 4 = 2.50 -> B
    percentage      300 / 4 = 75.00 -> C
    reported: B, by quality points

A tool that quietly reported the percentage average would give this student a C.
It gives a B. Verified in the live page, not just in the source.

**Rule 3, ten-point scale.** Right.

**Rule 4, round up at exactly .5.** Half right, and the wrong half moved letters.

89.5 came out an A, which is correct. So did 89.45, which is not. The cutoff test
was `Math.round(n * 10) >= 895`. That rounds the average to the nearest tenth
before comparing it to the boundary, so the real cutoff sat at x.45 rather than
x.5 at all four boundaries:

| Boundary | Rule says | Old code used |
| --- | --- | --- |
| A | 89.5 | 89.45 |
| B | 79.5 | 79.45 |
| C | 69.5 | 69.45 |
| D | 59.5 | 59.45 |

A four-quarter average of two-decimal percentages lands on a multiple of 0.0025,
so there are 40,001 averages the tool can actually produce between 0 and 100.
**80 of them got a letter one grade too high.** Twenty at each boundary. The
twenty at the bottom are the ones that matter:

    Q1 60.00 D=1   Q2 59.40 F=0   Q3 59.40 F=0   Q4 59.00 F=0
    quality points     1 / 4 =  0.25 -> F
    percentage     237.80 / 4 = 59.45 -> D  (old)   F  (correct)
    old tool reported: D, by percentage average
    now reports:       F

That is a student the old tool passed. Worth knowing before you use the fixed
version on anything you already checked: the correction moves grades **down**, and
only for averages sitting in the x.45 to x.4999 band.

The other half of rule 4 is the floating-point trap, and it is real. Of 8,205,049
four-quarter sets whose mean is exactly a .5 boundary, **422,651 evaluate to
something like 89.49999999999999**. A naive `avg >= 89.5` marks every one of those
a B. The old `Math.round(n * 10)` absorbed that noise, which is why it was written
that way, but it paid for it with the x.45 band above. The fix rounds to four
decimals first, which is the precision the data actually has, then compares
against the true .5 boundary. That kills the noise (0 misses across the same 8.2M
sets) without moving any real value. Three of those float-hostile sets are in the
test suite.

Quality points needed no change. Averages of four integers 0 to 4 are multiples of
0.25 and exact in floating point, and none of the 17 reachable values falls in a
dangerous band. All 17 are in the suite as a table.

**A missing or exempt quarter.** `calcFinals` already declined to produce a final
grade with fewer than four quarters, and that is the right answer, so it stayed.
The problem was that the importer rarely let it get asked.

**The importer, which is the actual headline.** The row splitter ended with
`.filter(c => c.length > 0)`, which threw away empty columns. Positions shift left,
and every column after the gap is read as the wrong quarter. Real TAC row, one
missing Q1:

    123457 <tab> Bartholomew Notreal <tab> SS7-3 <tab> 7 <tab><tab> B(84.00) <tab> A(91.00) <tab> A(93.00) <tab> 89.33

    read as:  Q1 84.00  Q2 91.00  Q3 93.00  Q4 89.33
    quality points  B,A,A,B = 14 / 4 = 3.50 -> A
    percentage      357.33 / 4 = 89.3325 -> B
    reported: A, by quality points. Zero warnings.

The 89.33 in Q4 is the system average column, the one the panel text says is
ignored. So a student with three quarters on file got a confident A built partly
out of the number the tool was supposed to be checking. Now:

    read as:  Q1 missing  Q2 84.00  Q3 91.00  Q4 93.00
    reported: no final grade
    warning:  "Row 2 (Bartholomew Notreal): 1 quarter(s) missing, so no final grade"

Two smaller importer faults, both fixed. The length guard was `cols.length < 6`
while the code read up to `cols[7]`, so a six-column row passed the guard and read
`undefined` for Q3 and Q4. And nothing range-checked a percentage: a paste
containing `A(950.00)` was accepted as a quarter grade of 950.

## What changed

**Read this first: half of task two was already done and had never been connected.**

`git log` says commit `8cf6575` ("auto updates using Code") already added
`Tools/final-grade-checker/grade-math.mjs` and all three vendored libraries. It did
not touch `Tools/final_grade_checker.html`. So at the start of this session the repo
held a corrected copy of the arithmetic that nothing imported, and 1.22 MB of
vendored libraries that nothing loaded, while the page users actually open was
still 808 lines with its own private copy of the old math and three live
`cdnjs.cloudflare.com` script tags. Dead code beside a shipping bug.

That matters for reading the section above: **every defect described there was
live on the site**, because the page never used the fixed module. It also means the
credit for the vendoring and for the module is not mine.

What this session actually contributed:

- wired the page to both, which is the part that makes any of it real
- the test suite, which did not exist
- `libs/README.md`, which did not exist
- two warning strings in `grade-math.mjs`

The three `libs/*.js` files are byte-identical to `HEAD` (sha256 compared). I
re-downloaded them from cdnjs before noticing they were already there and got the
same bytes, which at least confirms the committed copies are what cdnjs serves.

**`Tools/final_grade_checker.html`** (808 lines before, 833 after). This is the
session's real work.

- The three `cdnjs.cloudflare.com` script tags are gone. `grep cdnjs` returns 0.
- The arithmetic moved out to `final-grade-checker/grade-math.mjs`. The page
  imports it. The page script is now `type="module"`, which means the five inline
  `onclick=""` attributes could no longer reach it and are `addEventListener`
  calls instead.
- Libraries load on the first press of the button that needs them, not on page
  load. See the size numbers below.
- Deleted about 100 lines of Excel cell styling. SheetJS Community drops `cell.s`
  on write. Checked rather than assumed: write a sheet with fills and fonts set,
  unzip the result, and `xl/styles.xml` comes back with one font, two default
  fills, and no cell carrying a style index. It was decorating nothing. Column
  widths do survive and are still set.
- Every card now states its answer instead of leaving you to infer it from which
  box is starred: **Final: B, by quality points**.
- All import warnings are listed, not just the first one. The old status line said
  "3 warning(s): Row 2 …" and swallowed the rest.
- `tabindex="${i*5+q}"` came off the grade inputs. Any positive tabindex jumps
  ahead of every `tabindex=0` element on the page, so Tab from the top skipped the
  header buttons and the paste box and went straight into the grades, and each
  name field came after all twenty grade inputs. DOM order was already the order
  you type in.
- The paste box has a real `<label for>`. Imported cards use `<span>` where they
  had a `<label>` with nothing to point at. Focus rings are visible.
- The note bar prints now. A printed sheet saying "B" without saying which method
  produced it is not something you can hand to a parent. The winning box also gets
  a border in print, since colour alone does not survive a mono printer.
- 375 px layout: quarters go two-up instead of wrapping three-and-one.
- Blank manual rows are excluded from exports. Five empty "Student 4" lines in a
  PDF read as missing data rather than an empty form.
- Percentages show two decimals everywhere. It was 1 decimal on screen and in the
  PDF, 2 in the input, which made an 89.45 display as "89.5%" next to a B.
- A line under the buttons saying nothing is sent anywhere and nothing is saved.

**`Tools/final-grade-checker/grade-math.mjs`** (already in `HEAD`, 2 lines changed).
Pure functions, no DOM. I changed only the two import warning strings, to drop the
em dashes. The comment above the precision constant explains the two-sided rounding
problem so the next person does not "simplify" it back; that comment was already
there and it is right.

**`Tools/final-grade-checker/grade-math.test.mjs`** (new this session). 119
assertions, exits 1 on failure. No real names. Nothing was testing any of this
before, which is presumably how the module came to sit unimported without anyone
noticing.

**`Tools/final-grade-checker/libs/README.md`** (new this session). The libraries
were vendored with no record of what they were.

**`Tools/final-grade-checker/libs/`** (already in `HEAD`, unchanged). The exact
versions that were being hotlinked:

| File | Version | Licence | Bytes | KB |
| --- | --- | --- | --- | --- |
| `xlsx.full.min.js` | 0.18.5 | Apache-2.0 | 881,727 | 861 |
| `jspdf.umd.min.js` | 2.5.1 | MIT | 364,463 | 356 |
| `jspdf.plugin.autotable.min.js` | 3.6.0 | MIT | 38,026 | 37 |
| **Total** | | | **1,284,216** | **1,254 (1.22 MB)** |

I checked all three are actually used before accepting them: `XLSX.utils` and
`XLSX.writeFile` for the spreadsheet, `window.jspdf.jsPDF` and `doc.autoTable` for
the PDF. None is vendored for nothing.

But 1.22 MB on every page load for a page that adds up four numbers is not a trade
worth making, so **nothing is in a `<script src>` tag**. `loadLibs()` injects the
scripts on the first press of the button that needs them. Export PDF pulls 393 KB,
Export Excel pulls 861 KB, and a visit that exports nothing pulls **0 KB of
library**. jsPDF loads before its autotable plugin, in sequence, because the plugin
registers against it. `libs/README.md` now names each one, its version, licence and
source URL.

`xlsx` is 67% of that total and it is used for one thing: writing the file. It
never reads a spreadsheet, the import path is a paste box. Since its styling is
dead anyway, a CSV export would produce a visually identical file at zero library
cost. That is a product call, not a cleanup, so the Excel button still works and
the library is still there. Numbers are in the README.

## What I verified

Commands and their actual output.

```
node Tools/final-grade-checker/grade-math.test.mjs
  119 passed, 0 failed        (exit 0)

cd Tools/board-check && npm run check
  280 units checked, 0 broken
  0 collisions, tightest vertical gap 7.1px

npm run social:check
  23 notices · 23 already current · 0 out of date · 0 failed

grep -c cdnjs.cloudflare.com Tools/final_grade_checker.html
  0
```

**On the 280.** v7 recorded 235. Counted rather than assumed, by replicating
`check-integrity.mjs`'s `walk()`. `Tools/final-grade-checker/` holds 5 `.js`/`.mjs`
units, but 4 of them (the module and the three libraries) were already in `HEAD`
from commit `8cf6575`, so **this session adds exactly 1 unit**, the test file. The
rest of the gap between 235 and 280 is the vendoring commit plus the parallel
threads working in this repo while I was in it. The inline-script count for
`final_grade_checker.html` is still 1.

**Locked decision #34, each guard-rail watched failing.** Eight bugs reintroduced
into `grade-math.mjs` one at a time, suite run, file restored byte-for-byte
(verified by string compare). All eight exited 1:

| Reintroduced bug | Failures |
| --- | --- |
| `winner` always PCT | 5 |
| no normalise, bare `>=` on the raw float | 6 |
| the old `Math.round(n*10)` thresholds | 6 |
| `calcFinals` averages however many quarters it has | 8 |
| the old parser, empty columns filtered out | 7 |
| column guard back to 6 | 2 |
| range check removed | 5 |
| quarter window pinned to column 4 | 2 |

**In a real browser**, served over http on port 47681 via the existing
`gvb-static-site` launch config. Console errors across the whole session: none.
Network requests across the whole session: **10, every one of them to localhost.**
Zero offsite.

- Page load pulls exactly two things: the HTML and `grade-math.mjs`. No library
  bytes until a button is pressed.
- Typed 90/90/60/60 into the manual form: `avg 2.50 pts / B`, `75.00% / C`,
  `Final B by quality points`, Quality Points box starred.
- Exactly 89.5 (79, 79, 100, 100) -> A. The float-hostile 89.5 (58.80, 99.99,
  99.25, 99.96) -> A. 89.49 flat -> B. Three quarters only -> "no grade / all four
  quarters required".
- Pasted the three-row TAC sample including Bartholomew's empty Q1. Status:
  "Imported 3 students. 1 without a final grade. 1 warning below." His Q1 shows
  Missing, 89.33 never became a quarter, no final grade.
- **Exported a PDF for real** by pressing the button. Both libraries loaded from
  `./final-grade-checker/libs/`, autotable registered against jsPDF, button
  re-enabled. Captured the bytes and read the content stream back: title,
  "Generated July 28, 2026", the twelve headers, and per student
  `Ingrid Notapupil 90.00 90.00 60.00 60.00 2.50 B 75.00% C B Qual. Pts` and
  `Jerome Fabricated 79.00 79.00 100.00 100.00 3.00 B 89.50% A A Pct. Avg`. Both
  directions of the dual-method rule in one file. Producer `jsPDF 2.5.1`. The
  footer carries the .5 rule and the all-four-quarters rule.
- **Exported a spreadsheet for real**, then read it back with `XLSX.read`.
  `final_grades.xlsx`, sheet "Final Grades", 18,085 bytes, and every cell correct
  including `Bartholomew Notreal | Missing | 84 | 91 | 93 | Incomplete | | ... |
  No final grade | All four quarters required`. Blank manual rows absent.
- Tab order read off the live DOM: zero elements with a positive tabindex, order
  runs Clear All, Export Excel, Export PDF, Print, paste box, Import, Clear paste,
  warnings summary, name-0, Clear row, q1-0, q2-0.
- 375x812: `documentScrollWidth` 375, no horizontal overflow, quarters on two rows
  of two at 116 px each, result boxes and the final line full width at 328 px.
- Print rules read out of the CSSOM: `.legend, .import-panel` hidden, `.note-bar`
  visible with a border, `.result-box.winner` given a 2 px border.

**Not verified: no screenshots.** The browser pane was not compositing frames in
this session, so the mobile and print checks above are geometry and CSSOM
measurements, not pictures. Someone should look at it with their eyes.

Also not verified: **the quality-point thresholds against an actual county policy
document.** I kept the tool's existing 3.5 = A, 2.5 = B, 1.5 = C, 0.5 = D and
confirmed they are internally consistent and that .5 rounds up, but I had no source
to check them against. See Next session.

## Shared-file requests

Two, both for `Tools/board-check/**`, which is prompt 21's.

**1. Nothing in the browser suites ever opens a Tools page.** This is why the three
cdnjs hotlinks sat in production unnoticed while v7 §5 said the site made zero
offsite requests site-wide. `play-games.mjs` and `play-castle.mjs` assert
`page.__blocked` is empty, but only across the seven games. Suggested addition, a
new script `Tools/board-check/tools.mjs` wired to a `"tools"` script in
`package.json`, that for each of the six pages in `Tools/`:

```
  for (const page of ['final_grade_checker.html', 'image-to-pdf.html',
                      'Name Picker.html', 'Seating Chart Generator.html',
                      'Schedule Browser as of 260715.html',
                      'Schedule Visualizer and Browser Generator v60.html']) {
    // load it, then assert:
    //   page.__blocked is empty        (no offsite requests)
    //   zero console errors
    //   document.title is non-empty
  }
```

The `page.__blocked` assertion is the load-bearing one and it is the same helper
the game suites already use. If only one thing gets built, build that.

**2. Optional, the board description for this card.** Current text, generated into
the `gvb:social` block from `index.html`, is "Paste TAC report card summaries to
check end-of-year grades." Accurate but half the tool. It also does manual entry.
Suggested replacement, same length range:

```
Check end-of-year grades by hand or from a pasted TAC summary.
```

Only worth doing if prompt 21 is editing that area anyway. If it changes,
`npm run social` has to run afterwards or `social:check` will report drift on this
page.

Nothing needed from `assets/js/gvb-save.js`. No `href` change: the file name is
unchanged, so the board link still resolves.

## Deliberately not done

**No `localStorage`.** The prompt asked for an opinion and this is it: this tool
should not remember anything. What it holds is a class roster of grades, and the
machines it runs on are shared classroom machines. The saving is one paste. The
cost is a roster of student grades sitting in a browser profile until something
clears it, on a machine other people use. That trade is bad in a way that a
clear-all button does not fix, because the risk is the data existing at all, not
the data being hard to delete. The page now says out loud that nothing is stored.
If this gets revisited, the thing worth persisting is a roster of names with no
grades attached, which is a different and much smaller decision.

**Did not swap the Excel export for CSV.** It would remove 861 KB, 67% of the
vendored total, and produce a visually identical file, because the styling that
justified the library is dead. But removing a button a teacher may rely on is your
call. The numbers are in `libs/README.md` so the decision can be made in one
minute.

**Did not add level-based weighting.** Honors GT, Honors and Academic all run
through the same calculation, and there is no weighting anywhere in the tool. My
understanding is that CCPS quality points for a course final are the same 4/3/2/1/0
at every level and that weighting affects GPA rather than the course grade, which
is why this is written down rather than built. If that is wrong, it is a real bug
and it needs the policy text, not a guess.

**Did not touch the `gvb:social` block.** Locked decision #31. `social:check` says
23 of 23 current.

**Did not create a shared `Tools/libs/`.** `Tools/image-to-pdf.html` also uses
jsPDF and prompt 17 is editing it right now. Locked decision #17, and a duplicated
356 KB beats a merge conflict.

**The page now needs to be served, not opened off disk.** `type="module"` means
opening `final_grade_checker.html` by double-clicking it in Explorer gives a blank
page, where before it worked apart from the exports. It is fine on
greyversusblue.com and fine under the local server. I took this because the house
rule is plain ES modules and because it is the only way the browser and the Node
test can share one copy of the arithmetic, which is the whole point of the
exercise. The export error message mentions it. Flagging it because it is a real
regression for anyone who keeps a local copy.

## Next session

Ordered by value per effort.

1. **Check the quality-point thresholds against the written CCPS policy.** Ten
   minutes with the actual document. Everything else in this tool is now verified
   against something; this one number, 3.5 for an A on the quality-point average,
   is inherited from the previous code and verified only for internal consistency.
   It is the last unchecked assumption in a tool that sets report card grades.
2. **Build the Tools page sweep in `board-check`** (shared-file request 1). Three
   offsite hotlinks lived on a student-data page indefinitely because nothing
   measured it, and a whole vendoring commit landed without anyone noticing the
   page still hotlinked, for the same reason. Nothing still measures the other five
   tools.
3. **Letter-only quarters.** The importer wants a percentage. If a quarter ever
   arrives as a bare `B` with no number in brackets, `parseGradeToken` returns null
   and the student loses their final grade. Quality points only needs the letter,
   so the tool could still give half an answer. Worth ten minutes to find out
   whether that case happens before building for it.
4. **Decide on CSV instead of xlsx** (see Deliberately not done). 861 KB.
5. **Look at the page with your eyes at 375 px and in print preview.** I measured
   both and they measure correctly, but I could not get a screenshot out of this
   session.
6. **More than five manual rows.** `MANUAL_COUNT` is hard-coded at 5 and a section
   is nearer 28. Right now the way to do a whole class is the paste box. An "add
   row" button is small.
