# Schedule Visualizer and Browser Generator — session notes

## What is in the committed schedule data

**No student names.** Nothing in the file identifies a student, so there is no
FERPA disclosure here and nothing needs an emergency fix.

What is in it is the real staffing of East Middle School, published at
`greyversusblue.com`. `PUBLISHED_DATA` is one 18.5 KB JSON literal on line 281
of the old file, stamped `"school":"EMS","publishedOn":"2026-07-15"`, and it
contains:

- **34 teacher surnames**: Almer, Barrett, Byrd, Cavey, Davidson, Grisham,
  Harris, Hirsh, Hoeflich, Horichs, Hyman, Keen, Kelley, Lawson, Love, Merritt,
  Michie, Mielke, Moore, Oddis, Pfister, Piechowiak, Rogers, Saglimbeni,
  Schwaber, Seabolt, Sisk, Smith, Sparks, Tissue, Vogg, Worthy, Young, plus a
  pseudo-teacher "RA" for Related Arts. Surnames only, no first names.
- **Each teacher's room** (a103, c204, e102, b201 and so on), **department**,
  **which sections they teach**, **which colleagues they share students with**,
  and **which blocks are their planning periods** on A and B days.
- **33 section codes**: 6-1 through 6-11, 7-1 through 7-11, and the grade 8
  Academic / Honors / Honors GT / Algebra GT sections, each with its
  four-teacher team and the room it sits in per block.
- **Bell times**: 8:30–10:00, 10:00–11:30, 11:30–13:30, 13:30–15:00.
- **A floor plan.** `geometry.floors[0]` is a 50×30 grid with every corridor
  cell, every staircase cell, and the cell coordinates of all 34 rooms with the
  teacher in each. It draws an accurate map of the building's ground floor.

Your call, not mine, so I have not removed anything. What I would weigh:

The surnames and rooms are the kind of thing that is on a door and in a staff
directory, and a parent could learn all of it at back-to-school night. The part
that is different in kind is the **floor plan plus planning periods**: together
they say where a named adult is, and where a named adult is *not*, at each of
four times of day, on a public URL with no login. That is a school-security
question rather than a privacy one, and it is the reason I would ask before
leaving it up. Thirty-three colleagues are in it who did not choose to be.

If you want it to stay, nothing needs to change. If you want it gone, the file
is `Tools/schedule-browser.html`, the board card is prompt 21's, and the
generator will publish a fresh one whenever you want it back. That is what it
is for. A middle option that costs nothing: keep publishing the file and stop
committing it, hand it to staff as an email attachment instead. The publish
button already names the download `Schedule_Browser_EMS_<date>.html`.

## The versioned-filename decision

**Renamed, and I left redirects so nothing breaks.**

| Was | Now |
| --- | --- |
| `Tools/Schedule Visualizer and Browser Generator v60.html` | `Tools/schedule-visualizer.html` |
| `Tools/Schedule Browser as of 260715.html` | `Tools/schedule-browser.html` |

Both old paths still exist as 25-line stubs with `<meta http-equiv="refresh">`
and a visible link. **So no URL 404s**: not a bookmark, not a Schoology post,
not a link already emailed to staff. That was the only real argument against
renaming and it cost two small files to answer.

The version moved into the page. `TOOL_VERSION` is a constant near the top of
the script, shown in the header next to the school name, and stamped into the
footnote of every file the tool publishes: *"Published July 15, 2026 from the
School Layout Visualizer v60."* A teacher holding a printout can now say which
build made it, which a filename never told them.

What this actually buys: **a version bump and a republish are no longer board
edits.** Under the old names, v61 meant a new `href`, and in this round that
means a cross-thread request. `schedule-visualizer.html` is the href forever.

Costs, honestly:

- Two stub files in `Tools/` that look like leftovers. Both carry a comment
  saying what they are.
- The stubs currently hold the `gvb:social` blocks, because
  `sync-social-tags.mjs` follows `index.html`'s hrefs and those still point at
  the old paths. Once prompt 21 applies the two href changes below and runs
  `npm run social`, the blocks land on the real files. Harmless either way; the
  stale block on a stub is on a page nobody reads for two seconds.
- `Tools/` stays capitalised, both new names are lowercase and hyphenated, and
  neither has a space in it, so the board href stops needing `%20`.

I also reconciled the naming while I was in there. The `<title>` said "Movement
Visualizer", the filename said "Schedule Visualizer and Browser Generator", and
the board card said "School Layout Visualizer". Three names for one tool. The
board's name won, since it is the one a visitor sees first. Seven strings
changed, including the PNG and PDF export filenames.

## Coverage: what I actually read

18,777 lines. Structure: `<style>` 37–2723, body markup 2725–4823, main script
4824–17598, Schedule Browser markup 17600–17656, Schedule Browser script
17657–18775.

**Read properly, line by line (~2,400 lines, 13%):**

- The head, and every offsite reference in it.
- `AppState`, `DEFAULT_SETTINGS`, `SUBJECT_SEED`, `normalizeSettings` (4824–5010).
- `roomRegistry` / `rebuildRoomRegistry`, `serializeBlueprint`,
  `migrateBlueprintToFloors`, `applyBlueprintData` (5231–5460).
- All 29 `localStorage` call sites and the six key constants.
- `exportVizAsPNG` / `exportVizAsPDF` and `renderExportCanvas`'s tail (14290–14350).
- Full project export/import, `serializeFullProject` / `applyFullProject` (15998–16140).
- `syncHeader` and the header markup.
- The whole Schedule Browser block, 17600–18775. This is the part that produces
  the thing other people see, and it is where nearly all of my changes are.

**Skimmed, grep-driven, structure understood, not read as prose (~2,700 lines):**

- The stylesheet, 37–2723. I know what fonts, weights, families and custom
  properties it uses because I counted them; I have not read the rules.
- The schedules module and the bulk editor, roughly 9,700–11,506. I know the
  group/mods data shape from the import path and from the fixture round-trip.
- Section headers and function signatures across the rest, enough to write the
  coverage list below.

**Never opened (~13,700 lines, 73%):**

| Lines | Module |
| --- | --- |
| 1715–2322 | Visualize module CSS (Round 9) |
| 4028+ | What-If lab CSS (Round 51) |
| 9440–9578 | Bell schedule editor |
| 9578–9700 | Subjects editor |
| 11073–11506 | Bulk schedule editor |
| 11506–11993 | Pathfinding engine, and the multi-floor graph inside it |
| 11993–12206 | Edge-case-aware segment resolution |
| 12206–13495 | Path visualization and congestion colouring |
| 13495–14123 | Top-3 hotspot pulse overlay |
| 14324–14690 | Schedule completeness bar |
| 14690–15924 | Playback engine and travel-time estimator |
| 15924–15998 | Onboarding and help modals |
| 16139–16680 | Collapsible sidebar panels |
| 16680–17598 | What-If schedule lab |

So: I understand the data model, the two import/export paths, and the Schedule
Browser end to end. **I do not understand the simulation**: pathfinding,
congestion, playback, What-If, which is the half of the tool the name
"Movement Visualizer" was about. Anyone restructuring should assume I have not
seen it.

**On "what is the movement, and does the visualiser make it visible?"** From
the outside: it is real, and it is the better half of the tool. There is a
pathfinding engine over a tile grid with staircase portals and per-tile walk
times, a congestion heatmap, a top-3 hotspot overlay, and a playback engine
that walks student groups between classes on a clock. That is a tool about
bodies moving through a building at passing time, not a timetable grid. The
published Schedule Browser is the timetable-grid half, and it is the only half
that reaches anyone but you. The whole simulation sits behind a button
nobody outside your machine ever presses. Worth thinking about.

## What changed

**`Tools/schedule-visualizer.html`** (renamed from `... v60.html`), 858,827 →
862,583 bytes, +3,756:

- Head: Google Fonts link and the cdnjs jsPDF tag replaced with
  `schedule/fonts/fonts.css` and `schedule/libs/jspdf/jspdf.umd.min.js`, plus a
  new `schedule/fonts/published-fonts.js`.
- Deleted a hand-written `<meta name="description">` on line 6 that duplicated,
  and beat, the one in the `gvb:social` block. The board's copy had never
  actually shipped.
- **The publish template changed.** `brBuildPublishedHTML()` no longer emits a
  Google Fonts link; it inlines base64 `@font-face` rules from
  `BR_PUBLISHED_FONT_CSS`. If that script is missing it falls back to a system
  font stack and logs a warning, never back to a hotlink.
- `TOOL_VERSION = 'v61'`, shown in the header via `syncHeader()` and stamped
  into the published footnote.
- Seven "Movement Visualizer" strings renamed to "School Layout Visualizer".
- `var(--font-sans)` → `var(--font-ui)` at two sites. `--font-sans` was never
  defined, so those two controls were rendering in the browser default font.
- `.br-empty .big` given an explicit `font-weight:600`, matching the other nine
  Fraunces rules. It was inheriting 400, which no loaded face provided.
- `brGeoFloorSVG()` now hands its natural width out as `--geo-w`, and BR_CSS
  applies it as `min-width` below 900px. See below.

**`Tools/schedule-browser.html`** (renamed from `... as of 260715.html`),
58,097 → 160,738 bytes, +102,641:

Not regenerated, because it holds real data I cannot reproduce from a fake fixture, so
I hand-applied the same four changes: embedded fonts in place of the hotlink,
the Fraunces weight, the footnote wording, and the map `min-width` rule. Its
`PUBLISHED_DATA` is byte-identical to before.

**New, `Tools/schedule/`:**

| Path | Bytes | What |
| --- | --- | --- |
| `libs/jspdf/jspdf.umd.min.js` | 364,463 | jsPDF 2.5.1, MIT, byte-for-byte the cdnjs file |
| `libs/jspdf/README.md` |  | library, version, sha256, licence, source |
| `fonts/*.woff2` (11 files) | 163,380 | DM Sans 400/500/600/700, DM Mono 400/500, Fraunces 600, Public Sans 400/500/600/700 |
| `fonts/fonts.css` | 3,752 | `@font-face` for the generator page |
| `fonts/published-fonts.js` | 103,060 | generated: 5 faces, 76,576 bytes of woff2, base64 |
| `fonts/build-published-fonts.mjs` |  | regenerates the above |
| `fonts/README.md` |  | family/weight/licence/source table |
| `test/fixture-northwind.mjs` + `.json` | 5,817 | a fake two-floor school |
| `test/publish.mjs` |  | headless publish, and the baseline generator |
| `test/smoke.mjs` |  | 42 assertions |
| `README.md` |  | how to run all of it |

**Two redirect stubs** at the old paths, 2,576 and 2,628 bytes.

Font-weight arithmetic, since it drove what got vendored: the old Google URL
pulled DM Sans 300, Fraunces 300 and Fraunces 300-italic on every page load.
`font-weight:300` appears zero times in the file and all nineteen Fraunces
rules set 600 explicitly, so all three were downloaded and never drawn. The
same URL **did not request Public Sans at all**, which the Schedule Browser
stylesheet has always been set in, so the browser panel rendered in
`system-ui` inside the tool and in Public Sans once published. Same stylesheet,
two different results, and nobody would notice without opening both.

**The mobile map.** `.mapscroll` is `overflow-x:auto` and could never scroll,
because the SVG carried `style="width:100%"` and obediently shrank. At 375px
that drew East Middle's whole ground floor into 375px with room numbers about
4px tall. Checking a room assignment on a phone is the main thing anyone does
with a published file, so that was the wrong end of the trade to lose. Now:
1,316px at 1:1 with a horizontal scroll below 900px, unchanged shrink-to-fit at
1280px where the whole floor still fits in the panel. Measured: desktop svg
936px in a 968px container (fits), tablet and mobile 1,316px in 712px and 323px
(scrolls).

## What I verified

Actual commands, actual output.

**Generate, diff, generate.** Baseline from the unmodified generator, then the
same fixture after every change:

```
node Tools/schedule/test/publish.mjs baseline-pre.html
  fixture applied: 11 rooms, 4 groups
  wrote baseline-pre.html, 42707 bytes
  offsite requests blocked: [ 'https://cdnjs.cloudflare.com/.../jspdf.umd.min.js' ]

node Tools/schedule/test/publish.mjs baseline-post.html
  fixture applied: 11 rooms, 4 groups
  wrote baseline-post.html, 146718 bytes
```

The diff, with the base64 blobs elided, is seven hunks, minus 7 lines and plus
33, and every one of them is mine: three font `<link>`s out, five `@font-face`
rules in, the Fraunces weight, the map media query, the footnote wording, the
publish-header comment, and the `brGeoFloorSVG` return. **`PUBLISHED_DATA` is
byte-identical, and so are 23 of the 24 functions `brPublishFnList()` inlines**
(the exception is `brGeoFloorSVG`, which is one of the seven hunks). Zero
blocked requests on the second run, against one on the first.

**A PDF actually comes out.** Not the library in isolation, but the real
`exportVizAsPDF()` on the Visualize tab, with the blob intercepted at
`URL.createObjectURL`:

```
blob type     : application/pdf
bytes         : 21363645
header        : %PDF-1.3
has EOF marker: true
```

Which surfaces something: **21.4 MB for a fake school with eleven rooms.** It
embeds a full-resolution PNG of the export canvas. Nothing is broken, but that
is not a file anyone emails. Left alone, listed under next session.

**Greps, both files, zero each:**

```
                                     cdnjs  googleapis  gstatic
Tools/schedule-visualizer.html         0        0          0
Tools/schedule-browser.html            0        0          0
```

**`node Tools/schedule/test/smoke.mjs` → 42 passed, 0 failed.** Boots the
generator, imports the fixture, publishes, opens the result from `file://` with
no server, picks a teacher, reads the day, switches to the group view and the
building map, and checks the committed site copy separately.

**Locked decision #34, broke four things on purpose and watched them fail:**

| Break | Result |
| --- | --- |
| jsPDF `src` → `nope.js` | 4 failed: three jsPDF assertions plus page errors |
| `published-fonts.js` → `gone.js` | 2 failed. The fallback behaved: still zero Google Fonts references, system stack instead |
| `fonts.css` → `missing.css` | **1 failed, and it should have been 5** |
| (after fixing) same break | 5 failed, correctly |

The third row is the reason that decision exists. My four font assertions used
`document.fonts.check()`, which returns **true for a family with no
`@font-face` at all**, because the system can always fall back. All four passed
against a stylesheet that 404'd. They now walk the `FontFaceSet` and require a
declared face at `status === 'loaded'`, and they fail properly.

**`npm run social:check`** reported `2 DRIFT` immediately after the rename,
exactly as the prompt warned. The board's hrefs point at the old paths, which
are now my stubs, and stubs have no block. Ran `npm run social`, which wrote
the two stubs and touched nothing else:

```
23 notices · 23 already current · 0 had no block · 0 out of date · 0 failed
every page is in sync with the board
```

**`cd Tools/board-check && npm run check`:**

```
298 units checked, 0 broken
0 collisions, tightest vertical gap 7.1px
```

298, not 235. Nine of those are mine (seven new parseable files, two stubs);
the rest arrived from the other threads working in this repo at the same time.
The jsPDF UMD bundle parses cleanly under `--input-type=module`, which was not
guaranteed and is the thing that would have broken the integrity sweep.

I did not run `npm run games`, `npm run play` or `npm run previews`. They open
real windows, other threads may have been using them, and none of them drive
either of my files anyway.

## Shared-file requests

All three are in `index.html`, in the Town Services board, currently around
lines 636–647.

**1. Schedule Browser href.**

```
- <a class="notice" href="Tools/Schedule%20Browser%20as%20of%20260715.html">
+ <a class="notice" href="Tools/schedule-browser.html">
```

**2. School Layout Visualizer href.**

```
- <a class="notice" href="Tools/Schedule%20Visualizer%20and%20Browser%20Generator%20v60.html">
+ <a class="notice" href="Tools/schedule-visualizer.html">
```

Both old paths still resolve via redirect stubs, so nothing is broken if these
are not applied. Applying them is what stops the site serving a two-hop
redirect and puts the `gvb:social` blocks back on the real files.

**3. Run `npm run social` after applying 1 and 2.** The blocks are currently on
the stubs. One command, and `social:check` should still say 23/23.

**No `gvb-save.js` request.** I did not adopt it, see below, so there is no
missing hook to report.

**Card text:** no change needed. "School Layout Visualizer" and "A hyperlinked
map of teachers, rooms, and clusters" are both accurate; I moved the tool's own
naming to match the board rather than the other way round.

## Deliberately not done

**`gvb-save.js` adoption, all 29 call sites.** This is the one I most expected
to do and did not. The tool has six independent storage keys: `stviz_settings`,
`stviz_blueprint`, `stviz_schedules`, `stviz_viz_prefs`, `stviz_onboarded`,
and `stviz_whatif`, plus a numbered snapshot series behind `snapshotKey(slot)`
with its own quota accounting at 16311. That is six or seven slots, not one,
and `mountSaveBar` assumes a single one. The blueprint payload is also the
biggest state on the site by a wide margin and the snapshot code already
measures itself against quota, which no adopter so far has had to think about.
It is a session of its own, and doing it badly on top of a file with no tests
was the worse option. The tests now exist, which is the part that had to come
first. Keys stay exactly as they are when someone does it (locked decision #36),
and the fill-ins scattered through the current `load()` paths belong in `repair`,
not `migrate` (#37).

**The 859 KB restructure.** It is the strongest case in the repo and I did not
touch it, because I read 13% of the file. A generator with a template, an
importer, a layout engine, a pathfinder and a UI does want to be five files.
Splitting code I have not read, in a tool with no test suite, is how a working
tool becomes a broken one. The right order is: tests first (done, for one
path), read the simulation half, then split. Say two more sessions.

**The 21 MB PDF export.** Understood, left alone. `renderExportCanvas()`
produces a full-resolution PNG and `addImage` embeds it uncompressed. The fix
is either JPEG at quality, or a lower export DPI, or drawing vectors instead of
a raster. Three different answers with three different looks, and picking one
is your call, not a bug fix.

**Italics.** Six `font-style: italic` rules in the visualizer and two in the
browser stylesheet. No italic face is vendored, because the Google URL never
requested one either, and the browser has always synthesised them. Shipping real
italics would change how the tool looks, which is a design decision and not
part of removing a network dependency.

**`.rcell` versus `.geo-room`.** Two SVG floor-plan renderers with two class
names, both live: `.geo-room` draws the Building Map, `.rcell` draws the
smaller "Where to find you" plan on a teacher's own page. They look like
duplication and might merge, but they are genuinely doing different jobs and I
did not read enough of either to be sure.

**The three-cell-wide `.mapscroll` hint.** The map scrolls on a phone now, with
no visual affordance saying so. A shadow on the scroll edge is the standard fix.
Small, cosmetic, not done.

**Print stylesheet.** There is one. `@media print` hides `.overview`,
`.footnote` and the toggle buttons, and the teacher and group views print
sensibly. I did not test the Building Map printing across a page break, which is
the case most likely to be wrong.

**Accessibility, past a first look.** The tables use real `<table>`/`<th>`
markup and the day cards are headed lists, so a screen reader gets a sensible
structure. The mode switcher has `role="tablist"` on the container but the three
buttons have no `role="tab"` and no `aria-selected`, so the state is conveyed by
a CSS class only. That is a real gap on the file other people use. Not fixed
because I would want to check the whole widget, not one attribute.

**The real data.** Not removed, not altered. Your call, per the top of this file.

## Next session

Value per effort, highest first.

1. **Decide about the committed floor plan** (top section). Five minutes of your
   judgement, and it is the only item here with anyone else's name on it.
2. **`role="tab"` / `aria-selected` on the Schedule Browser mode switcher.**
   Fifteen minutes, in the file staff actually open, and the suite is there to
   catch a mistake.
3. **The 21 MB PDF.** Pick a compression story and implement it. Half a session.
   Currently the export button produces a file too big to email, which is what
   people export for.
4. **Read the simulation half**, 11,506 to 15,924, pathfinding through
   playback, and extend the suite to cover it. A full session, and the
   prerequisite for anything after this.
5. **Then split the file.** Template, importer, layout engine, pathfinder, UI.
   Not before 4.
6. **`gvb-save.js` adoption**, six slots plus the snapshot series. A session,
   and it wants the storage-quota question answered rather than inherited.
7. **Scroll affordance on the mobile map**, and check the Building Map across a
   print page break. Both cosmetic, both quick.
