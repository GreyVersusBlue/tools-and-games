# 19 — Schedule Visualizer and Browser Generator

You are working on the Schedule Visualizer and Browser Generator, a classroom tool on
greyversusblue.com under the board's "Town Services" section. **At 18,707 lines and 859 KB it is by
far the largest hand-written file in the repo** — more than twice the next biggest — and it is a
generator: it produces the second file you own. It also handles school schedule data, so the
data-handling section below is not boilerplate. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Schedule Visualizer and Browser Generator v60.html` (18,707 lines, 859 KB) — the generator
- `Tools/Schedule Browser as of 260715.html` (632 lines, 58 KB) — **its generated output**, dated
  15 July 2026
- Any new folder you create under `Tools/` **named for this tool** — e.g. `Tools/schedule/`

You own both files because they are one system: the second is the first's output, and changing the
generator's template without regenerating the output leaves the site serving a stale page. No other
thread touches either.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions are working on other projects in this same repo right
now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. **It carries a card for each of your two files**, both with `href`s containing a version number and a date. Prompt 21. |
| `Tools/creature_artwork_gallery.html` | **Being deleted this round** by prompt 21. Not yours; don't reference it. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 20. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't. Both your filenames contain spaces, which the board URL-encodes as
`Tools/Schedule%20Visualizer%20and%20Browser%20Generator%20v60.html` and
`Tools/Schedule%20Browser%20as%20of%20260715.html`. If you rename anything, verify the rename landed
in git and not only on disk, and remember every rename is a board `href` change.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own files: each `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). They are regenerated from the board's notices by `npm run social`, and your
edit will be silently overwritten. **This is a real trap for you specifically:** if your generator
emits a `<head>` for the browser file, it must reproduce those markers and their contents exactly, or
`npm run social:check` will report drift on every regeneration. Check what the generator currently
does about this before you touch its template.

## Required reading

1. This whole file, including the versioned-filename problem and the student-data section.
2. `gvb-site-handoff-v6.md` §3 — how favicons and OG tags are generated into every page's head from
   `index.html`'s notices, and locked decisions #31 and #32. You are the only tool that *also*
   generates HTML, so you are the only one that can fight with `sync-social-tags.mjs`.
3. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state).
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
5. `assets/js/gvb-save.js` and `assets/js/README.md`.

## The versioned-filename problem — decide this before anything else

Your two files are named `... v60.html` and `... as of 260715.html`. Both names are baked into public
URLs and into `index.html`.

That means **every new version of the generator and every regeneration of the browser is a board
edit**, which is now a cross-thread request rather than a one-line change. It also means the site
accumulates a card per version, or silently overwrites history, and a bookmark to v59 either 404s or
was never made because nobody bookmarks a versioned file.

There is a better shape and it is worth doing: **stable filenames plus a version shown in the page.**
`Tools/schedule-visualizer.html` and `Tools/schedule-browser.html`, each displaying "v60" and
"generated 15 July 2026" in the interface where a user can actually see it. The board `href` then
never changes again, the generator's output path stops being a decision, and the version information
ends up where it is useful instead of in a URL.

The cost is real and you must name it: **the current URLs stop resolving.** Anyone with
`Tools/Schedule%20Browser%20as%20of%20260715.html` bookmarked, or a link to it in a Schoology post or
an email to staff, gets a 404. `404.html` exists and is on-theme, so the failure is graceful rather
than ugly, but it is still a break.

**Make the call, do it or don't, and write the reasoning either way.** If you do it, both board
`href`s become Shared-file requests with the exact old and new paths. If you don't, say what would
change your mind.

## Student and staff data: handle with care

This tool handles school schedules. Depending on what it ingests, that can include staff assignments
and student placements, and student schedules are education records under FERPA.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint, ever.
  Apart from the CDN script noted below, the tool is currently clean and must stay clean.
- **Do not put real schedule data in the repo.** This is the sharpest version of that rule in the
  whole set, because **the generated browser file is a data file committed to a public GitHub
  repository served at a public domain.** `Tools/Schedule Browser as of 260715.html` is 58 KB of
  something, and the first thing you should do in this session is **open it and find out exactly whose
  names and which rooms are in it.** If it contains real student names, that is a live disclosure on a
  public website and it is the most important finding in this batch of twenty-one sessions — report it
  at the top of your notes immediately. If it contains only staff names and room numbers, that is a
  judgement call rather than a violation, and it is Devon's call to make; flag it clearly with what
  exactly is exposed and let him decide.
- Any sample or fixture you create uses obviously fake names.

If you add persistence, anything in `localStorage` sits on a shared machine until cleared. A visible
clear-all control and one honest sentence about what is stored are both required.

## What is actually here

**The generator:** `Tools/Schedule Visualizer and Browser Generator v60.html`, 18,707 lines, 859 KB.
The `<title>` says "Movement Visualizer", which does not match either the filename or the board card —
worth reconciling, and note the board card's text lives in `index.html` (a request), while the
`<title>` outside the `gvb:social` markers is yours. Twenty-nine `localStorage` call sites,
hand-rolled. It pulls jsPDF from `cdnjs.cloudflare.com` at line 28, and hotlinks four Google Font
families — DM Sans, DM Mono, Fraunces and Public Sans — at lines 25, 27 and again at 18,673 and
18,675. **Those last two are almost certainly inside the output template**, which means the generator
bakes a font hotlink into every browser file it produces. Check that.

**The output:** `Tools/Schedule Browser as of 260715.html`, 632 lines, 58 KB, no `localStorage`,
hotlinks Fraunces and Public Sans. A static, self-contained artifact.

**Offsite requests.** v7 §5 claims the site makes zero offsite requests site-wide. That is wrong for
fifteen pages, and the reason nobody caught it is twofold: `prepPage()` in
`Tools/board-check/harness.mjs` *fulfills* Google Fonts requests locally from bundled `@fontsource`
packages before the blocked-list check runs, so font hotlinks never reach `page.__blocked`; and the
browser suites only ever drive the seven games, never the tools. **Nothing measures either of your
files.** Of your four families, **Fraunces and Public Sans** are among the twelve `@fontsource`
packages already on disk under `Tools/board-check/node_modules/` — copy woff2 files out, but nothing at
runtime may reference `node_modules`. **DM Sans and DM Mono are not there**, so you will be sourcing
those two yourself.

**The practical consequence of the jsPDF hotlink** matters more than the privacy one: a teacher on
school wifi behind a filter that blocks cdnjs gets a tool that loads, looks fine, and then does
nothing when they click export.

## Your task

There is no handoff backlog for this tool. It has never been the subject of a session, and at 859 KB
it is the largest unexamined thing in the repo.

**Task one: find out what is in the generated browser file** and report it, per the student-data
section. Do this first; it takes five minutes and it is the only item here that could be urgent.

**Task two: decide the versioned-filename question** per the section above, and act on your decision.

**Task three: vendor jsPDF and the four font families.** jsPDF into a `libs/` folder you own at the
version currently requested, with a README naming library, version, licence and source, the way
`Projects/golden-hour-beach/assets/textures/README.md` does. Fonts as local `@font-face` with only the
weights actually used. **And fix the generator's template so the output it produces is also clean** —
otherwise you fix one file and the generator recreates the problem on the next run. Measure everything
and report the numbers (locked decision #42, which exists because a size estimate wrong by 4× blocked a
good decision for two sessions).

**Task four: audit and plan, then build what fits.** 18,707 lines is too much to understand fully in
one session, so **be honest about coverage**: say what you read, what you only skimmed, and what you
did not open. A plan that admits its blind spots is worth more than one that implies it saw everything.

Worth forming an opinion about:

- **Actually use it.** Load real-shaped (fake-named) schedule data and generate a browser file. Then
  open the output and use it as a teacher would. That will find more than reading 18,707 lines.
- **What is the "movement" the title refers to**, and does the visualiser make it visible? A tool that
  shows how bodies move through a building at passing time is a genuinely useful thing; a tool that
  shows a timetable as a grid is a different, lesser thing. Say which this is.
- **859 KB in one file.** This is the strongest restructure case in the repo, stronger than Daredevil's
  6,683 lines. A generator with a template, an importer, a layout engine and a UI wants to be four
  files. **But weigh it against how much of the file you actually understand** — a refactor of code you
  skimmed is how a working tool becomes a broken one, and this tool has no test suite at all. It may be
  right to write a test suite this session and restructure the next. Say so if it is.
- **Twenty-nine `localStorage` call sites, hand-rolled.** `assets/js/gvb-save.js` gives you validation,
  a memory fallback for browsers that block storage (**reading the `localStorage` property throws
  outright** in that configuration, which a `try/catch` around `setItem` never reaches), and file
  export/import. Keep every existing key exactly as it is (locked decision #36); put fill-ins in
  `repair` rather than `migrate` (locked decision #37) because `repair` runs on every accepted load from
  every door and `migrate` only on version drift; pass `defaults` as a factory if any default is
  non-literal, or `slot.reset()` hands back `null`. A missing hook is a Shared-file request, not an edit.
- **Import/export formats.** Where does schedule data come from — a paste, a CSV, an xlsx? Whatever it
  is, that is the tool's real interface, and making it tolerant of the actual mess that comes out of a
  school scheduling system is usually the highest-value work in this class of tool.
- **Print output.** A schedule browser gets printed and put on a wall. Check the print stylesheet.
- **Mobile.** 375×812, for the browser file especially — a staff member checking a room assignment on
  their phone is the main use case for the output, even if the generator is desktop-only. Those two
  files can legitimately have different answers here.
- **Accessibility.** Table semantics, contrast, keyboard navigation, and whether a schedule grid reads
  sensibly to a screen reader. The output file is the one to get right; it is the one other people use.

## Verification

Neither file has a test suite, and at 859 KB that is the largest untested surface in the repo. If you
change anything structural, it needs one — put it in a folder you own and make it exit non-zero on
failure (locked decision #13).

- **Before changing anything, generate a browser file from the current generator and keep it.** That
  output is your only regression baseline. After any change, generate again and diff. A generator whose
  template silently drops a column gives you no error at all.
- **Open the generated output in a browser and use it**, every time. A generated file that parses is not
  a generated file that works.
- After vendoring, load both files with the network panel open and confirm zero requests leave the site.
  Then grep both for `cdnjs.cloudflare.com` and `fonts.googleapis.com` → zero hits each. Then **actually
  export a PDF**, because a vendored library with a wrong path fails at the moment you use it, not at
  load.
- `npm run social:check` → 23 notices, 23 already current. **This is the check most likely to catch you
  out**: if your generator emits a `<head>` and does not reproduce the `gvb:social` block byte-for-byte,
  every regeneration will read as drift. Run it after generating, not just after editing.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you finish,
  especially if you renamed anything — this is the sweep that catches a broken link, and you are the
  thread most likely to create one.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/19-schedule-visualizer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

Use these headings:

```
# Schedule Visualizer and Browser Generator — session notes

## What is in the committed schedule data
## The versioned-filename decision
## Coverage: what I actually read
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the three extra headings, which only this prompt asks for.

- **What is in the committed schedule data** — exactly whose names and what details are in
  `Tools/Schedule Browser as of 260715.html`, which is public. Answer plainly. If there are real
  student names, say so in the first sentence.
- **The versioned-filename decision** — what you decided, what it costs, and which URLs break.
- **Coverage: what I actually read** — of 18,707 lines, what you read, skimmed, and never opened. Be
  honest; this is the most useful thing you can hand the next session.
- **What changed** — files touched and why, with paths. Vendored totals in KB. **If you changed the
  generator's template, say so explicitly** and say whether you regenerated the output.
- **What I verified** — actual commands, actual output. Include the generate-diff-generate baseline
  check, the PDF export, and `npm run social:check` after generating. "Should work" is not verification.
- **Shared-file requests** — both board `href`s if you renamed, both card descriptions if the
  "Movement Visualizer" mismatch should be reconciled there, any `gvb-save.js` gap with the exact hook
  signature. Applicable blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the reason.
  For an 859 KB file this section will be long, and that is correct.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was wrong,
say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or "robust"
anywhere.
