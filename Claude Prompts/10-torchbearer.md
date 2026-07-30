# 10 — Torchbearer

You are working on Torchbearer, a Pathfinder 2e adventure engine on greyversusblue.com. It
is a 233 KB single-file game that loads user-supplied adventure content, and it carries
`class="has-suite"` on the board — it advertises itself as a platform, not one adventure.
This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/torchbearer.html` (3,181 lines, 233 KB)
- `Projects/torchbearer/` — `content-authoring-guide.md`,
  `packs/thornwake-vigil.json`, `packs/embers-of-the-hold.json`, `js/library.js`,
  `js/save.js`, `js/registry.js`, `test/smoke.mjs`
- Any new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this
same repo right now, and this boundary is the only thing keeping that from becoming a merge
fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. Currently version 9; your board entry has no `data-preview` yet. |
| `Pathfinder/**` | Prompts 01, 02, 03. **Relevant to you** — `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't create a runtime dependency on it. Whether that data is a shared interface or private to prompts 01-03 is still an open question raised independently by you and The Absalom Inheritance (`gvb-site-handoff-v8.md` §8, §10 #5) — it needs Devon, not code. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. Two of your own requests from round 1 landed as locked decisions #47 and #48 this round — see below. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 21. This game still has neither — see "What is actually here." |
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
2. **`Claude Prompts/notes/10-torchbearer-notes.md`** — round 1's session on this exact
   project. It has the fully-written preview recipe and `play-games.mjs` beats ready to
   transcribe, and the full account of what it found and fixed. `Claude Prompts/archive/`
   holds earlier rounds if you need more history than that.
3. `Projects/torchbearer/content-authoring-guide.md` — this is the contract between the
   engine and its content. Read it before you touch the engine.
4. Both JSON packs in `Projects/torchbearer/packs/`, as worked examples of that contract.
5. `gvb-site-handoff-v8.md` §4 (the shared save module, five gaps found and fixed — two are
   yours), §6 (previews, why yours is the one deferred), §8 (the `Pathfinder/data/`
   question), §9 locked decisions #47 and #48, §10 (suggested next session, #1 is your
   preview).
6. `assets/js/gvb-save.js` and `assets/js/README.md`, plus `Projects/torchbearer/js/save.js`
   as your own worked example of adopting it.

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
  `repair` also covers content drift, not just schema drift (locked decision #50) — your own
  session found the version of this bug, where `resources` copied wholesale from an old save
  silently dropped a field a newer scene depends on.
- **`mountSaveBar` takes `filename` and `labels` overrides, and its import handler calls
  `setState` before writing to storage, vetoable by returning `false`** (locked decisions #47,
  #48). Both are your own requests from round 1, now applied — see "What is actually here"
  for what this means for your hand-rolled Export button.
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` —
  a bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34). Two
  versions of a line-of-sight check once passed the whole suite while doing nothing at all.
  Your own suite's first draft did exactly this too — see the notes file.
- **Assert against the DOM for anything that just happened, and against the save only for
  what a reload has to survive** (locked decision #39).

## What is actually here

3,181 lines in one file, 233 KB. Title: "Torchbearer — A Pathfinder 2e Adventure Engine".
Tagged `CRPG` with `has-suite` on the board. **Still no preview and no OG image** — the
clearest remaining gap, and the reason is specific: generating one needs a `.torchsave.json`
from an actual playthrough of the nine-step character builder, and building that file blind
(without playing it) risks committing a save that fails the game's own validator the first
time anyone reads it, which is worse than no preview at all. `gvb-site-handoff-v8.md` §6 and
§10 both flag this as the top suggested item for the whole site, not just this project.

**The folder restructured.** `Projects/Torchbearer files/` (with a space, two loose JSON
files) is gone. It is now `Projects/torchbearer/`, git-tracked rename: `content-authoring-guide.md`,
`packs/thornwake-vigil.json`, `packs/embers-of-the-hold.json`, plus new `js/library.js`,
`js/save.js`, `js/registry.js`, and `test/smoke.mjs`. **The page itself stayed at
`Projects/torchbearer.html`** — the board `href` is unchanged, nothing to request.

**The two bundled adventure packs are reachable now.** A new "Shelf" section on the title
screen fetches `packs/index.json` and loads a pack in one click, instead of a player needing
to know the packs exist and hand-feed raw JSON to a file picker. It fails silently over
`file://` or offline — the Shelf just hides itself, and Load Content JSON still works.
`CORE_PACK` and `ADVENTURE_PACK` stayed inline in the HTML on purpose, so booting never waits
on a network request. 4 same-origin requests total, 0 offsite.

**`assets/js/gvb-save.js` is adopted.** `Projects/torchbearer/js/save.js` holds the slot. Key
is unchanged, `torchbearer-save` (locked #36). Version 2 — old saves carry `{"v":1}` with no
`__v`, read as version 0, and come through `migrate` (drops the dead `v` field) then `repair`
like everything else. `repair` catches a real bug: `App.loadSave` used to copy
`hero.resources` wholesale, so a save whose resource block predates a field (e.g. `potions`)
lost that field permanently, and `hero.resources.potions++` on `undefined` silently went to
NaN forever. The save bar lives in the topbar, on screen during play, not behind a title
screen. `mountSaveBar` mounts `["import"]` only — Export is still hand-rolled, because a
Torchbearer save has always been named after its hero (`sera-voss.torchsave.json`) and
`mountSaveBar` had no filename hook when this project adopted the module. **That hook exists
now** (locked decision #48, `filename` and `labels` options, landed via this round's shared-file
pass) — Torchbearer's hand-rolled Export button could be replaced with `mountSaveBar(...,
{buttons: ["export", "import"]})` using the new `filename` option instead. Nobody has done
this yet; it's a small, low-priority cleanup, flagged below.

**The Registry/Validator gained 8 new rules**, every one a promise the authoring guide
already made but never checked: `start` names a real scene, every scene has `text` and
`title`, `victory`/`defeat` name real scenes, every encounter foe names a real monster, every
`companionsOffered` id is real, a background's `feat` exists. All bundled packs pass with
zero errors.

**Fixed: `{"grantFeat": "<id>"}` did nothing.** The only code reading `grantFeat` handled two
magic-string cases, not arbitrary ids — so no Fighter had ever been able to Shield Block in
this game's history, and both Warpriest doctrines had the same problem. Fixed; `activeEffects`
now resolves the id and applies that feat's own effects.

**`loadSave` fails usefully now.** A save naming an unloaded pack's content used to hard-throw;
it now names the missing ids and explains where to get them, and a companion or adventure from
an unloaded pack only costs that specific thing, not the whole save.

**The character builder is keyboard-accessible.** It was mouse-only before — `<div
class="opt-card">` with `onclick`, no focus, no ARIA, across 8 different template strings. One
`makeCardsFocusable()` pass plus one delegated keydown handler fixes all of them, including
future ones. Also: `role="log"` on the Chronicle, real modal dialog semantics, `role="status"`
on the toast, `aria-hidden` on the decorative d20 overlay.

**Mobile is fixed at 375×812** (was 202px of horizontal overflow, now 0; the party rail went
from a 250px vertical column to a 375px horizontal strip).

**`Projects/torchbearer/test/smoke.mjs`, 86 checks, exits non-zero on failure.** No browser
needed — slices the two inline packs out of the HTML, runs them through the real validator,
feeds it eleven deliberately-broken packs, and drives the save slot through every door. All
four guard-rail reintroductions (locked #34) confirmed failing correctly when tried.

**The `Pathfinder/data/` question is still unresolved.** Same open question The Absalom
Inheritance independently raised: is `Pathfinder/data/`'s 24 JSON files a published interface
other projects can build against, or private to prompts 01-03? `gvb-site-handoff-v8.md` §8
and §10 #5 both list it as still needing Devon's decision, not code.

## Your task

**Task one: the preview and OG image, and the `npm run games` entry.** This is the highest
value item left and it is transcription, not design. Play the nine-step character builder
once in a real browser, export the hero, and commit the save file under
`Projects/torchbearer/test/`. Round 1's own notes file
(`Claude Prompts/notes/10-torchbearer-notes.md`) already has the full `games.mjs` recipe
written out (Shelf load, load Thornwake, import the committed save) and the five beats worth
driving for `npm run games` (shelf load, export, reload, import, corrupt-file-rejected) — both
are ready to hand to whoever owns `Tools/board-check/games.mjs` as a shared-file request, or
transcribe yourself if that boundary has changed. Locked decision #28: a preview is a frame
from *play*, and the capture has to prove it got there — round 1's notes suggest the
Thornwake bridge scene mid-combat, party rail, 13×7 grid with five tokens, and the Chronicle
showing a rolled d20, as the shot that proves this is a tactical engine and not a text
adventure.

**Task two: implement `assurance`.** Cheapest of six inert engine hooks documented honestly in
the authoring guide as not working. It is a floor on a skill roll; the check already funnels
through `App.rollCheck`; two Assurance feats and the Farmhand background use it. Doing this
one first establishes the pattern for the rest.

**Smaller items, roughly in order:**

- **Decide the potion `heal` question.** Drink Potion rolls a flat `1d8` and ignores the
  item's `heal` field. Core's Lesser Healing Potion advertises `2d8+5` and heals `1d8`.
  Either make the action read the item's `heal` field, or change the two core items' text to
  say `1d8` to match the engine. Either is fine; the current mismatch is not. This is a
  balance decision, not a bug fix, so name it as such.
- **The other five inert hooks**: `surprise-attack`, `racket-scoundrel`, `edge-outwit`,
  `mobility`, `crossbow-ace`. Real combat work, budget most of a session if you take these on.
  `racket-scoundrel` is the most visible — one of three Rogue rackets and the only one that
  does nothing.
- **Grey out Shield Block** in the general-feat list for classes that already grant it as a
  class feature, now that the class feature actually works. Small, one condition in the feat
  list builder.
- **The `mountSaveBar` cleanup** noted above — swap the hand-rolled Export button for
  `mountSaveBar(..., {buttons: ["export", "import"], filename: () => ...})` now that the
  module supports naming the file after the hero. Low priority; the hand-rolled version works
  correctly today, this is tidiness.
- **`Pathfinder/data/` (request #4 from round 1).** Still not yours to decide alone — this
  needs a conversation with whoever owns `Pathfinder/`, not code. Don't build a runtime
  dependency on it this session either.
- **Splitting the file into a folder** — deliberately not done last round because it breaks
  the URL for no benefit (the three pieces that needed to be Node-testable are already out as
  modules). Worth revisiting only alongside something else that already justifies a board
  `href` change.

## Verification

- `node Projects/torchbearer/test/smoke.mjs` → **86 passed, 0 failed**.
- Open the page in a real browser. Load a pack from the Shelf, play it in, export a hero,
  clear storage, import it back, confirm you get the same state. Try a deliberately corrupt
  `.torchsave.json` and confirm the running game survives it.
- `cd Tools/board-check && npm run check` → **327 units checked, 0 broken**, 0 collisions
  across nine widths, tightest vertical gap 9.2px.
- `npm run social:check` → **22 notices, 22 already current, 0 out of date, 0 failed**. Drift
  on your page means you edited inside the `gvb:social` markers.
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**. Torchbearer is one of the
  eleven current adopters; this suite is the shared module's, not yours, but a failure here
  before you've touched it is worth flagging.
- `npm run games` currently reports **126 checks, 0 failed** and does not yet include
  Torchbearer. Once task one lands, it should.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and
  watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible
browser windows, and Chrome throttles a window that loses focus. Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/10-torchbearer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v9.md` gets assembled from all twenty-one of them.

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
