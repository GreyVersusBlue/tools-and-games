# notes

One file per prompt, written by that prompt's session and nobody else. That is what makes twenty-two
parallel sessions safe to merge: no two threads ever write the same file.

Expected names:

```
01-anathema-archive-notes.md          12-coffee-shop-sim-notes.md
02-pathfinder-campaigns-notes.md      13-daredevil-notes.md
03-pathfinder-characters-notes.md     14-integer-foundry-notes.md
04-aphelion-notes.md                  15-fracture-cycle-notes.md
05-castle-conundrum-notes.md          16-final-grade-checker-notes.md
06-closing-time-notes.md              17-image-to-pdf-notes.md
07-fourth-quarter-notes.md            18-name-picker-notes.md
08-golden-hour-notes.md               19-schedule-visualizer-notes.md
09-faire-weekend-notes.md             20-seating-chart-generator-notes.md
10-torchbearer-notes.md               21-orbital-notes.md
11-absalom-inheritance-notes.md       22-general-site-improvements-notes.md
                                       23-refresh-prompts-notes.md
```

Every file uses these headings, and a few prompts add one extra at the top:

```
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

**"Shared-file requests" is the load-bearing one.** No project thread may edit `index.html`,
`assets/js/gvb-save.js`, `Tools/board-check/**`, or the generated `assets/previews` and `assets/og`.
When a thread needs one of those changed it writes the exact edit here instead, and prompt 22 — run
last — applies them all in one pass, then bumps the version line and writes the next
`gvb-site-handoff-v*.md` (v9, as of round 2) from these twenty-two files.

A request that never gets written down is a change that never happens. A request written vaguely is
one prompt 22 has to guess at. Write them so someone can apply them without having read the session.

**This folder still holds all twenty-two notes files even for a project living in
`Claude Prompts/Stable/`.** Moving a prompt to `Stable/` only relocates the prompt file itself —
its notes file stays right here, same filename, same as every other project's.

## These files get overwritten every round

The next round's threads write to the same filenames. Prompt 23 copies the whole folder into
`Claude Prompts/archive/round-N/` before that happens, so earlier rounds survive there and nowhere
else. As of this refresh, `archive/round-1/` and `archive/round-2/` both exist. If you are looking
for what a project did in an earlier round, that is where it is.
