# 10 — Torchbearer

You are working on Torchbearer, a Pathfinder 2e adventure engine on greyversusblue.com. It
is a 227 KB single-file game that loads user-supplied adventure content, and it carries
`class="has-suite"` on the board — it advertises itself as a platform, not one adventure.
This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/torchbearer.html` (2,972 lines, 227 KB)
- `Projects/Torchbearer files/` — `content-authoring-guide.md`,
  `sample-expansion-embers-of-the-hold.json`, `thornwake-vigil (1).json`
- Any new folder you create under `Projects/` **named for this game** — e.g.
  `Projects/torchbearer/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this
same repo right now, and this boundary is the only thing keeping that from becoming a merge
fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `Pathfinder/**` | Prompts 01, 02, 03. **Relevant to you** — `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't create a runtime dependency on it this session. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 21. This game currently has neither. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`;
your edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. `Projects/Torchbearer files/content-authoring-guide.md` — this is the contract between the
   engine and its content. Read it before you touch the engine.
3. Both JSON files in that folder, as worked examples of that contract.
4. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state).
5. `assets/js/gvb-save.js` and `assets/js/README.md`, plus
   `Projects/fourth-quarter/js/campaign.js` as the worked example, and
   `gvb-site-handoff-v7.md` §1 for what adopting the module cost and bought.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm
  dependency.
- **Zero offsite requests.** This game hotlinks nothing — no Google Fonts, no CDN. It is one
  of the few pages in the repo where that is genuinely true. Don't regress it.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision
  #17).
- **Never change a storage key** (locked decision #36). Yours is `torchbearer-save`. It keeps
  that name. Unversioned saves read as version 0 and come through `repair`.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` —
  a bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34). Two
  versions of a line-of-sight check once passed the whole suite while doing nothing at all.
- **Assert against the DOM for anything that just happened, and against the save only for
  what a reload has to survive** (locked decision #39).

## What is actually here

2,972 lines in one file, 227 KB. Title: "Torchbearer — A Pathfinder 2e Adventure Engine".
Tagged `CRPG` with `has-suite` on the board. No preview and no OG image, unlike the seven
games that have them.

**It already has file export and import**, which is unusual in this repo. There is a hidden
`<input type="file" id="file-input" accept=".json,.torchsave">` at line 447, and around line
2934 it builds a download named `<hero-name>.torchsave.json`. It also writes
`localStorage` under `torchbearer-save`.

**The two JSON files in `Projects/Torchbearer files/` are not loaded by the page.** Nothing in
`torchbearer.html` references that folder, `thornwake`, or `embers-of-the-hold` — the string
count is zero. They are content packs a user loads by hand through the file picker, sitting in
the repo as samples. That is worth knowing before you plan anything, and worth deciding about:
a platform whose sample content can only be loaded by hunting for a file in a GitHub folder is
a platform nobody will try.

**Two file-naming things to clean up while you're in there.** `thornwake-vigil (1).json` has a
browser-download " (1)" suffix baked into its name. And the folder is called `Torchbearer
files` with a space and a lowercase f, which is inconsistent with every other path in
`Projects/`. Both are yours to fix. Note that `Tools/` is capitalized on purpose (locked
decision #14) — Windows hides case differences, git and GitHub Pages don't — so if you rename
anything, verify the rename actually landed in git rather than only on disk.

## Your task

There is no handoff backlog for this game. It has never been the subject of a session.

**Audit, plan, then build the top items.** Write a prioritized improvement plan into your
notes, ordered by value per effort, with tradeoffs named. Then implement the highest
value-per-effort items in this same session and verify them. Don't stop at the plan.

Things worth forming an opinion about:

- **The sample content is unreachable in practice.** Fix that. An in-page adventure picker
  that fetches the bundled packs, or a "load sample adventure" button, turns a file the user
  must find into one click. The engine already parses these files; it just never fetches one.
  This is probably the single highest-value item here and it is small.
- **Adopt `assets/js/gvb-save.js`.** You are the best-fitting candidate in the repo, because
  you have already hand-rolled the thing the module does: `localStorage`, plus file export,
  plus file import. The module gives you all three plus a memory-backed fallback for browsers
  that block storage (reading the `localStorage` property *throws outright* in that
  configuration) plus validation, and it means one implementation of "refuse to load garbage"
  instead of yours. Specifics that bit the first adopter, from v7 §1:
  - Keep the key `torchbearer-save` (locked #36).
  - **`defaults` may be a factory** — if a new hero involves anything randomised, pass a
    function or `slot.reset()` hands back `null`.
  - **Fill-ins go in `repair`, not `migrate`** (locked #37), because they have to run on every
    accepted load from every door: localStorage, an imported file, a pasted blob, and a save
    the current build just wrote. Go looking for your version of the bug that hook exists to
    catch — a field added since the game shipped, absent from an old save, used in arithmetic
    where `undefined` becomes NaN and something silently never happens.
  - **`mountSaveBar` takes a `buttons` option** and each button carries
    `data-gvb="export|import|reset"`. **Put the bar somewhere reachable during play** — v7 §9
    has a whole item open because The Fourth Quarter's is only on its start screen, so
    exporting mid-game needs a page reload.
  - A missing hook is a Shared-file request, not an edit to `gvb-save.js`.
  - **Careful with the import path if you split the file up.** Import relatively
    (`../assets/js/gvb-save.js`), not `/assets/js/gvb-save.js`, so any Node test can resolve
    it.
- **Is the authoring guide accurate?** It is the contract, and a stale contract is worse than
  none. Check it against what the engine actually parses, field by field, and against both
  sample files. If it drifted, that is a bug in the most important document here.
- **2,972 lines in one file.** You may restructure into `Projects/torchbearer/index.html` plus
  `js/` and `css/`. For a platform with a content format, splitting the engine from the content
  loader from the UI is a real gain. **But it breaks the URL** — `/Projects/torchbearer.html`
  stops resolving, so the board `href` must change, which is a Shared-file request, and you
  should say plainly in your notes that the old URL breaks. Decide on merit and say why either
  way.
- **PF2e rules data is next door.** `Pathfinder/data/` has 24 JSON files — ancestries, classes,
  feats, spells, heritages, deities, hazards, treasure. An adventure engine that could read
  them would be a different tool. **You do not own that folder**, so this belongs in the plan
  and in Shared-file requests, not in code this session.
- **No preview and no OG card**, unlike the seven games that have them. Getting one means a
  recipe in `Tools/board-check/games.mjs` and a run of `npm run previews` — both prompt 21's.
  If you think this game deserves one, request it, and say what the frame should show.
  Locked decision #28: a preview is a frame from *play*, and the capture has to prove it got
  there.
- **Mobile.** 375×812. A text-and-choices adventure engine should work well on a phone; check
  whether it does.
- **Accessibility.** Heading order, contrast, keyboard navigation, and whether the dice and
  combat output read sensibly to a screen reader.

## Verification

This game has no test suite. If you touch anything structural, that is worth fixing — put any
new Node suite in a folder you own, and make it exit non-zero on failure (locked decision #13).

- Open the page in a real browser and actually play an adventure through. Load both sample
  packs. Export a hero, clear storage, import the hero back, and confirm you get the same
  state — that round trip is the one thing most likely to be quietly broken, and it is
  untested today.
- Try a deliberately corrupt `.torchsave.json` and see what happens. Right now, probably
  nothing good. That is the argument for adopting the shared module in one sentence.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before
  you finish, especially if you renamed a file — this is the sweep that catches a broken link.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited
  inside the `gvb:social` markers.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and
  watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible
browser windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be
running them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/10-torchbearer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v8.md` gets assembled from all twenty-one of them.

Use these headings:

```
# Torchbearer — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths. If you renamed anything, say
  what the old and new paths are.
- **What I verified** — actual commands, actual output. Include the export/import round trip
  and the corrupt-file test. "Should work" is not verification.
- **Shared-file requests** — a new board `href` if you restructured, a preview recipe if you
  want one, anything you need from `Pathfinder/data/`, any `gvb-save.js` gap with the exact hook
  signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something
was wrong, say what was wrong and what the evidence was. Match that. Do not write
"comprehensive" or "robust" anywhere.
