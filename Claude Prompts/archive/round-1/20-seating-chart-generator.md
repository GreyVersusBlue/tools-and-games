# 20 — Seating Chart Generator

You are working on the Seating Chart Generator, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It builds classroom seating charts. **It has no persistence
whatsoever**, which for this particular tool is the whole story. It also handles student names, so
the data-handling section below is not boilerplate. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Seating Chart Generator.html` (1,031 lines, 45 KB)
- Any new folder you create under `Tools/` **named for this tool** — e.g. `Tools/seating-chart/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions are working on other projects in this same repo right
now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. |
| `Tools/creature_artwork_gallery.html` | **Being deleted this round** by prompt 21. Not yours; don't reference it. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 19. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't. Your filename contains spaces, which the board URL-encodes as
`Tools/Seating%20Chart%20Generator.html`. If you rename it, verify the rename landed in git and not
only on disk, and the board `href` becomes a Shared-file request.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section.
2. `assets/js/gvb-save.js` and `assets/js/README.md`. All of it — this is the module you are almost
   certainly adopting.
3. `Projects/fourth-quarter/js/campaign.js` — the module's worked example — and
   `gvb-site-handoff-v7.md` §1 for the three gaps adopting it found, §2 for the bug class its
   `repair` hook exists to catch, and §9 for the still-open mistake of putting a save bar somewhere
   unreachable.
4. `gvb-site-handoff-v7.md` §10 locked decisions #36 through #40.
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."

## Student data: this is the part that matters

**A seating chart is a list of student names mapped to physical positions in a room.** That is an
education record under FERPA, and it is also the kind of document that gets printed and left on a
desk.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint, ever.
  The tool is currently clean on this and must stay clean — it hotlinks two font families and nothing
  else.
- **Do not put real student names in the repo.** Any sample roster, fixture or screenshot uses
  obviously fake names. **Check the current file for real names before you do anything else** — a
  seating chart tool with a hardcoded example class is entirely plausible. If you find one, that is
  the first item in your notes and it comes out.
- **If you add persistence — and you almost certainly should — a visible "clear all data" control is
  required**, and the UI has to say in one honest sentence what is stored and where. This runs on a
  classroom machine other people use.

There is a specific tension worth thinking about rather than ignoring. Seating charts often encode
*why* a student sits somewhere: front row for a vision IEP, apart from a particular classmate, near
the door. **Any notes field invites exactly that**, and a stored note about a student's needs is more
sensitive than the name itself. If you add notes, that is a legitimate feature — teachers need it —
but it belongs behind clear labelling about what it is, and it is a strong argument for making export
easy and storage clearable rather than for storing more.

## What is actually here

1,031 lines, 45 KB, one file. Title: "Seating Chart Generator". Tagged with the school stamp under
Town Services.

**Zero `localStorage` calls. Nothing is saved.** Every chart is built from scratch, every time.

For most pages in this repo an absent save is a minor gap. **Here it is the tool's defining
limitation, and it is worse than it sounds.** A seating chart is not a one-off artifact — it is a
document a teacher revises across a year, for each of several sections, as students move and
groupings change. A generator that cannot reload yesterday's chart is a generator that gets used
once per class and then replaced by a photograph of the whiteboard. Everything else you might improve
here is downstream of that.

It also means the tool is currently doing something slightly odd: it generates a chart whose only
persistence is whatever the user does with the output. Find out what the output actually is — print,
PDF, image, or nothing at all — because that determines how urgent the save is.

**It hotlinks two Google Font families** — Fraunces and Spline Sans — at lines 24 and 26. v7 §5 claims
the site makes zero offsite requests site-wide. That is wrong for fifteen pages, and the reason nobody
caught it is twofold: `prepPage()` in `Tools/board-check/harness.mjs` *fulfills* Google Fonts requests
locally from bundled `@fontsource` packages before the blocked-list check runs, so font hotlinks never
reach `page.__blocked`; and the browser suites only ever drive the seven games, never the tools.
Nothing measures this file. **Fraunces** is already on disk in
`Tools/board-check/node_modules/@fontsource/`; Spline Sans is not. Nothing at runtime may reference
`node_modules` either way.

Note that Fraunces is hotlinked as a variable font with an optical-size axis
(`opsz,wght@9..144`) — vendoring a variable font is one file and one `@font-face` with ranges, not a
stack of static weights. Get that right.

## Your task

There is no handoff backlog for this tool. It has never been the subject of a session.

**Task one, the headline: give it persistence, and adopt `assets/js/gvb-save.js` to do it.**

Do not hand-roll `localStorage`. Four tools and six games in this repo hand-rolled it and the module
exists because that went badly. What you get: validation so a corrupt blob is refused rather than
`JSON.parse`d into state, a memory-backed fallback for browsers configured to block storage
(**reading the `localStorage` property throws outright** in that configuration — not `setItem`, the
property access itself — which a naive `try/catch` never reaches), and **file export and import,
which for this tool is arguably more important than the storage.** A chart exported to a file moves
between the classroom desktop and a laptop, survives a wiped machine, and can be handed to a
substitute.

Specifics that bit the first adopter, from v7 §1 and §2:

- **Pick your storage keys once and keep them forever** (locked decision #36). Something like
  `seating-chart-v1`. Changing a key later silently loses charts, and charts are the thing that took
  the longest to build.
- **Design for multiple sections from the start.** A teacher running Honors GT, Honors and Academic
  needs several charts, not one, plus probably several room layouts. Getting the slot shape right now
  is much cheaper than migrating it later — and once real charts exist on a real machine, migrating
  means writing a `repair` pass for data you can't see.
- **`defaults` may be a factory.** If a new chart involves anything non-literal — a generated room
  grid, a randomised seating pass — pass a function, or `slot.reset()` hands back `null`. That exact
  gap was found by The Fourth Quarter's three random job applicants.
- **Fill-ins go in `repair`, not `migrate`** (locked decision #37). `migrate(state, from)` only runs
  when the stored version differs; `repair` runs on **every** accepted load from every door —
  localStorage, an imported file, a pasted blob, including data the current build just wrote. You are
  starting clean, which makes this the one chance to get the shape right before you have legacy data.
- **The bug class `repair` catches**, so you design against it from day one: The Fourth Quarter had a
  staffer saved before roles existed; the loader filled in `role` and `skill` but never `speed`, and
  that got multiplied into metres per second. An `undefined` there produced a NaN that never arrived
  anywhere — no error, no crash, just something that silently never happens. Your equivalent is a
  seat property added in a later version.
- **`mountSaveBar` takes a `buttons` option** (`["export", "import"]`, etc.) and each button carries
  `data-gvb="export|import|reset"`. **Put it somewhere reachable while working**, not behind a start
  screen — v7 §9 has an item still open because The Fourth Quarter's save bar lives only on its start
  overlay, so exporting mid-campaign means reloading the page.
- **Import relatively** — `../assets/js/gvb-save.js` — so any Node test can resolve it.
- **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`. Six projects read that
  file. Write the exact signature you need and work around it locally meanwhile.

**Task two: vendor the two fonts.** Fraunces (variable, with its `opsz` axis) and Spline Sans. Local
`@font-face`, woff2 in a folder you own, hotlinks deleted, only the weights actually used. README
naming source and licence, the way `Projects/golden-hour-beach/assets/textures/README.md` does.
Measure and report the total (locked decision #42, which exists because a size estimate that was wrong
by 4× blocked a good decision for two sessions).

**Task three: audit and plan, then build what fits.** Write a prioritized plan. Worth an opinion:

- **Actually build a chart for a real-shaped class** — twenty-eight fake names, a room that isn't a
  perfect rectangle, a couple of seats that must stay empty. Then print it. That exercise will find
  more than reading the code.
- **What is the output?** Print, PDF, PNG, or nothing? A seating chart's whole purpose is to end up on
  paper on a desk or on a screen for a substitute. If the print stylesheet is an afterthought, that is
  probably the second-highest-value item after persistence. Check the actual printed page, not the
  screen.
- **Room layouts.** Can you describe a room that isn't a grid — pairs, pods, a horseshoe, a lab bench
  arrangement? Real classrooms are rarely rectangular grids, and a tool that only does grids gets
  abandoned by exactly the teachers who most need a chart.
- **Constraints.** Does the tool support "these two apart", "this student at the front", "leave this
  seat empty"? Those are the actual reasons a teacher builds a chart rather than seating alphabetically.
  If it randomises with no constraints, adding even two of them changes what the tool is for. Read the
  student-data section above before adding a free-text notes field.
- **Roster entry.** Typing twenty-eight names is the cost of first use, and paste-a-column is the fix.
  Check whether it handles a paste from a spreadsheet — that is where every roster actually comes from.
- **1,031 lines does not need restructuring** and you should probably say so rather than doing it. If
  you split it anyway, `/Tools/Seating%20Chart%20Generator.html` stops resolving and the board `href`
  is a Shared-file request. Say plainly that the old URL breaks.
- **Mobile.** 375×812. Less compelling here than for the Name Picker — building a chart is desk work —
  but *viewing* one on a phone while standing in the room is a real case, and those can be different
  answers.
- **Accessibility.** A drag-and-drop-only seating editor is unusable without a mouse. Check there is a
  keyboard path, that every control has a label, and that the chart itself reads sensibly to a screen
  reader rather than being a grid of unlabelled boxes.

## Verification

This tool has no test suite. If you add persistence, it needs one — put it in a folder you own and make
it exit non-zero on failure (locked decision #13). The seat-assignment and constraint logic is pure
arithmetic and exactly what a Node test is for.

- **Build a real-shaped chart by hand and print it**, before and after your changes. That is your only
  regression baseline and nothing else exists.
- Once persistence exists, test the round trip by hand: build a chart, reload, confirm it is intact.
  Then export to a file, clear storage, import, confirm again. Then feed it a deliberately corrupt file
  and confirm it is refused rather than loaded.
- **Test with storage blocked.** Chrome's site settings will do it. The tool should still run, not
  white-screen. This is the case the module's memory fallback exists for and the case a hand-rolled
  `try/catch` around `setItem` never covers.
- Test multiple charts if you support them: build two, switch between them, confirm neither clobbers the
  other.
- After vendoring, grep the file for `fonts.googleapis.com` → zero hits. `page.__blocked` is **not** the
  check; `prepPage()` fulfills those requests.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you finish,
  especially if you renamed anything.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited inside
  the `gvb:social` markers.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it fail.
  A save test that passes against a tool with no save is not a test.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/20-seating-chart-generator-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

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

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any real
student names were in the file, what the tool now stores and where, whether a user can clear all of it
in one action, whether the UI tells them the truth about it, and — if you added a notes field — what you
did to make it clear what that field is for.

- **What changed** — files touched and why, with paths. **Name every storage key explicitly**; they are
  permanent now and the next session needs to know them. Vendored font total in KB.
- **What I verified** — actual commands, actual output. Include the printed chart, the save round trip,
  the corrupt-file test and the storage-blocked test. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you renamed, any `gvb-save.js` gap with the exact hook
  signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was wrong,
say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or "robust"
anywhere.
