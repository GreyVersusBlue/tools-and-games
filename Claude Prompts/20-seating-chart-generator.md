# 20 — Seating Chart Generator

You are working on the Seating Chart Generator, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It builds classroom seating charts. Round 2 closed all four of
the previous round's tasks: named room zones with a real solver constraint, four layout presets,
print-all-sections, and inverting its own now-stale test assertion. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Seating Chart Generator.html` (1,437 lines)
- `Tools/seating-chart/` — `seating.mjs` (pure logic, no DOM), `test/smoke-seating.mjs`,
  `test/drive-seating.mjs`, `fonts/`, `README.md`, `.gitignore`, `shots/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo, and
this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 19. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Your filename contains spaces
(`Tools/Seating%20Chart%20Generator.html`). If you rename it, verify the rename landed in git and
the board `href` becomes a Shared-file request.

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section.
2. **`Claude Prompts/notes/20-seating-chart-generator-notes.md`** — round 2's session: room zones
   with a real solver constraint, four layout presets, print-all-sections, and its own test-assertion
   inversion. Round 1's notes are archived at
   `Claude Prompts/archive/round-1/notes/20-seating-chart-generator-notes.md` — the original save
   adoption, the rewritten print stylesheet, keyboard operation, the two solver bugs.
3. `assets/js/gvb-save.js` and `assets/js/README.md`.
4. `gvb-site-handoff-v9.md` §3 (a bug **found in your own `test/drive-seating.mjs`** this refresh,
   not fixed there — see below) and §10 (locked decisions #51-53).
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."

## Student data: this is the part that matters

**A seating chart is a list of student names mapped to physical positions in a room.** That is an
education record under FERPA, and it is also the kind of document that gets printed and left on a
desk.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint.
- **Do not put real student names in the repo.** Checked again this round from scratch, still clean
  — only historical-figure placeholders. Check again anyway before you touch anything.
- **A visible "clear all data" control exists.** "Erase saved data" in the toolbar.
- **Zone tagging holds to the same print bar as the flag and notes field** — a desk's zone badge is
  hidden on the printed page, same reasoning as the gold flag outline: the tool needs to know where
  a student sits; whoever picks the sheet off a desk doesn't.

## What is actually here

1,437 lines, one file. Title: "Seating Chart Generator." Tagged with the school stamp under Town
Services.

**Persistence, through `assets/js/gvb-save.js`.** Storage key `seating-chart-v1`, schema version
still 1 — this round's additions are new fields on the existing shape, filled in by `repair`
(locked decision #37), not a version bump.

**Room zones exist, with a real solver constraint.** `ZONES` is three fixed entries (front row, by
the door, back corner). A desk carries a `zone` field, a student carries `zoneNeed`; both are `''`
unless set by hand — **deliberately not inferred from x/y coordinates**, since a desk's position
doesn't say what it means in a horseshoe or a pod layout, which is exactly where the flag matters
most. `onePass` filters a student's candidate desks to the matching zone before the existing
keep-apart/put-together filters run.

**Four layout presets exist**: `horseshoeDesks`, `podsDesks`, `doubleRowDesks`, `labBenchDesks`.
Each returns a desk array in the same shape `gridDesks`/`rowDesks` already produce, clamped inside
the room. Zone tagging is deliberately not part of any preset — guessing a zone from a preset's own
coordinates would be exactly the guess the room model exists to avoid.

**Print all sections in one job.** A new toolbar button builds a static, independently-scaled copy
of every section's floor into one holder, one page per section with `page-break-after: always`.
Falls back to the existing single-print path below two sections.

**`Tools/seating-chart/test/smoke-seating.mjs`, 153 assertions** (was 123), **all passing** — the
construction-time-throw assertion this project's own notes flagged as needing inversion is
inverted and confirmed clean this refresh (`153 passed, 0 failed`). Not outstanding.
`test/drive-seating.mjs`, **108 checks** (was 81).

**A real, newly-found bug in this project's own test file, not previously flagged: `test/drive-
seating.mjs` uses two Playwright-only methods that don't exist under this environment's
`puppeteer-core`**, not covered by prompt 21's fix (project-owned test files are out of its
boundary). Confirmed by direct run this refresh: `TypeError: page.isHidden is not a function`, at
lines 80 and 394 (`page.isHidden('#bootWarn')`), and `page.textContent(...)` at lines 82 and 396.
See task one.

## Your task

Round 2 closed all four of the previous round's tasks. What's left:

1. **Fix `test/drive-seating.mjs`'s Playwright-only calls** (see above). `Tools/board-check/drive.mjs`
   exports an engine-aware `textContent(page, sel)` you can import for the two `page.textContent()`
   calls. For `page.isHidden('#bootWarn')`, there's no ready-made replacement in `drive.mjs` — the
   simplest fix is `await page.$eval('#bootWarn', el => el.offsetParent === null)` or an equivalent
   direct check, since `isHidden` itself is a Playwright convenience with no puppeteer-core
   equivalent. Verify per locked decision #34.
2. **Rotated desk labels**, if the rotate control is actually getting used — the horseshoe preset's
   side legs are the first case in this tool's history where rotation is applied automatically
   rather than by a teacher's own click, so it's worth checking whether that changes the answer to
   "does anyone rotate desks" from round 1's "watch for ten minutes first."
3. **The four pages still hotlinking Google Fonts** (`index.html`, `404.html`,
   `Projects/daredevil_r4.html`, `Projects/Ren-Faire-Claude/index.html`) as of round 1's check —
   re-verify this is still accurate before citing it; several of these have since been fixed by
   other threads (Daredevil restructured, for one). Not this project's files regardless.
4. Nothing else outstanding from the round-1 or round-2 task lists remains beyond items 1-2 above.

## Verification

- `node Tools/seating-chart/test/smoke-seating.mjs` → **153 passed, 0 failed** (confirmed clean as
  of this refresh — not outstanding).
- `node Tools/seating-chart/test/drive-seating.mjs` → currently **aborts** on the bug in task one
  above. Fix that first, then expect 108 checks, 0 failed.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed.
- `cd Tools/board-check && npm run tools` → 18 checks, 0 failed.
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken; 0
  collisions, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression; the parse failure that blocked this check previously is fixed).
- Locked decision #34 still applies to anything new you add.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus. This page isn't part of `npm run games`,
but the one-suite-at-a-time rule still applies if another thread is running one alongside you.

## Output: your notes file

Write `Claude Prompts/notes/20-seating-chart-generator-notes.md`. Nobody else writes that file, so
it can never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-one of them each round.

Use these headings:

```
# Seating Chart Generator — session notes

## Student data
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any
real student names were in the file, what the tool stores and where, whether a user can clear all
of it in one action, whether the UI tells them the truth about it.

- **What changed** — files touched and why, with paths. Name every storage key explicitly if you
  touch storage.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you renamed, any `gvb-save.js` gap with the exact
  hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
