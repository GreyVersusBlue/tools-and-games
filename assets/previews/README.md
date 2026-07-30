# Notice previews (hover unfurl)

Drop a screenshot in here and it appears automatically — the board attaches
each preview only if the file actually loads, so a missing one leaves the
notice looking exactly as it does today. No HTML edit needed.

**All seven listed below now exist.** They were not taken by hand:
`Tools/board-check` plays each game into a real gameplay frame
(`npm run previews`), and `npm run promote` turns a chosen frame into both this
330×200 JPEG and the 1200×630 share card in `assets/og/`. If a game's look
changes, re-run those two rather than screenshotting manually — the specs below
are enforced by the promote step.

## Filenames the board is already asking for

| File | Quest |
| --- | --- |
| `castle-conundrum.jpg` | Castle Conundrum |
| `aphelion.jpg` | Aphelion |
| `golden-hour.jpg` | Golden Hour |
| `fourth-quarter.jpg` | The Fourth Quarter |
| `faire-weekend.jpg` | Faire Weekend |
| `closing-time.jpg` | Closing Time |
| `integer-foundry.jpg` | Integer Foundry |
| `absalom-inheritance.jpg` | The Absalom Inheritance |
| `daredevil.jpg` | Daredevil |
| `fracture-cycle.jpg` | The Fracture Cycle |
| `corner-and-kettle.jpg` | Corner & Kettle |

Torchbearer is the one remaining quest with neither — see
`gvb-site-handoff-v8.md`'s backlog for why (it needs a prebuilt save file from
an actual playthrough, not something to generate blind).

## To add one for a different quest

Put the image here, then add `data-preview="assets/previews/<name>.jpg"` to
that notice's `<a>` in `index.html`.

## Specs

- **330 × 200** or thereabouts (it renders at 165 px wide, so this is 2×).
- Landscape. The unfurl slides out to the upper right, so keep the subject
  centred-left — the right third gets the least attention.
- JPEG, quality ~80, under about 60 KB. These load on page view, not on
  hover, so a heavy folder is a slow board.
- Grab the frame that shows the game *playing*, not a title screen. The
  point is to answer "what does this actually look like" before the click.

The unfurl is hidden below 760 px and on touch-only devices, so these never
cost a phone visitor anything but the download — which is the main reason to
keep them small.
