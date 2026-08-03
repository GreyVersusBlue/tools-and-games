**This project had nothing outstanding as of round 3 (2026-08-03).** Checked: `test/smoke.mjs`
95/95, its `npm run games` entry clean (7/7, part of the site-wide 146/146 fair-environment run),
all three of round 2's feature items wired (edge-outwit, Feint, reload) and independently
confirmed on disk. What's left is one item blocked on a prerequisite that doesn't exist yet
(`mobility`, needs monster-data support nobody has built), one trivial stale comment, and the
site-wide `Pathfinder/data/` question tracked centrally in prompt 01 rather than owned here. None
of the three is actionable engine work. Re-verified against the live repo by this refresh, not
just carried forward on the session's own claim. If a monster ever gets a reach reaction, or
`Pathfinder/data/` gets resolved in a way that changes this project's boundary, move this back to
the live `Claude Prompts/` folder and give it a real task list again.

# 10 — Torchbearer

You are working on Torchbearer, a Pathfinder 2e adventure engine on greyversusblue.com. It
is a single-file game that loads user-supplied adventure content, and it carries
`class="has-suite"` on the board — it advertises itself as a platform, not one adventure.
**Round 3 wired all three of the previous round's feature items** (edge-outwit's AC half, a real
Feint action, a reload mechanic for crossbow-ace) and did the `mountSaveBar` cleanup. What's left
is `mobility` (still blocked on a monster-data prerequisite, not an engine task) and the
site-wide `Pathfinder/data/` question (Devon's call, tracked in prompt 01). This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/torchbearer.html` (3,268 lines)
- `Projects/torchbearer/` — `content-authoring-guide.md`,
  `packs/thornwake-vigil.json`, `packs/embers-of-the-hold.json`, `js/library.js`,
  `js/save.js`, `js/registry.js`, `test/smoke.mjs`, `test/sera-voss.torchsave.json`
  (a real committed playthrough save, round 2)
- Any new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this
same repo at the same time, and this boundary is the only thing keeping that from becoming a merge
fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 22. Now has `data-preview` pointing at your game — see below. |
| `Pathfinder/**` | Prompts 01, 02, 03. `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't create a runtime dependency on it. Whether that data is a shared interface or private to prompts 01-03 is a real open question — see prompt 01's "Questions for Devon" block, which now tracks it centrally. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `assets/previews/torchbearer.jpg`, `assets/og/torchbearer.jpg` | Generated. Prompt 22. **These exist now** — 9.2 KB / 64.4 KB, captured this round from your committed save. |
| `Tools/board-check/**`, including your new `play-games.mjs` entry (7 checks) and `games.mjs` recipe | Shared dev tooling. Prompt 22. |
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
2. **`Claude Prompts/notes/10-torchbearer-notes.md`** — round 3's session: edge-outwit's AC half,
   a real Feint action (unlocking `racket-scoundrel`), a reload mechanic (unlocking
   `crossbow-ace`), and the `mountSaveBar` cleanup (the old hand-rolled Export button and
   `App.exportSave()` are gone). Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/10-torchbearer-notes.md` — Assurance (two bugs, not one),
   the potion-heal bug (every Lesser Healing Potion silently healing ~10 HP short of its own text),
   the Shield Block double-grant fix, `surprise-attack`, and the committed save fixture. Round 1's
   are at `Claude Prompts/archive/round-1/notes/10-torchbearer-notes.md`.
3. `Projects/torchbearer/content-authoring-guide.md` — the contract between the engine and its
   content, updated this round with the Feint/reload mechanics.
4. Both JSON packs in `Projects/torchbearer/packs/`, as worked examples of that contract.
5. `gvb-site-handoff-v10.md` §3 (the repo-wide `sync-social-tags.mjs` false-DRIFT bug this project
   independently reported, root-caused and fixed this round) and §10 (locked decisions, through
   #58).
6. `assets/js/gvb-save.js` and `assets/js/README.md`, plus `Projects/torchbearer/js/save.js`.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm
  dependency.
- **Zero offsite requests.** This game hotlinks nothing.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision
  #17).
- **Never change a storage key** (locked decision #36). Yours is `torchbearer-save`.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
  `repair` also covers content drift, not just schema drift (locked decision #50) — this round's
  potion fix went through `repair` (`normalizePotions`, accepting either a real array of ids or a
  legacy plain number), not a version bump, since it's the same content-drift shape.
- **`mountSaveBar` takes `filename` and `labels` overrides** (locked decisions #47, #48).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34). Round 2's own
  `normalizePotions` guard-rail check found that reverting it doesn't just fail an assertion, it
  crashes the whole suite — `.push()` on an unrepaired `undefined` throws outright, louder than the
  old flat-counter bug ever was.
- **Assert against the DOM for anything that just happened, and against the save only for
  what a reload has to survive** (locked decision #39).

## What is actually here

3,268 lines in one file. Title: "Torchbearer — A Pathfinder 2e Adventure Engine". Tagged `CRPG`
with `has-suite` on the board. Has a preview and an OG card, unchanged this round.

**`edge-outwit` works, both halves.** `Combat.effAC` gets the +1 AC term against hunted prey; the
+2 Deception/Intimidation/Stealth bonus applies to Demoralize (existing) and to the new Feint
action (below) when either targets the hunted foe.

**A real Feint action exists now** (button, `resolveTargeted` case), unlocking `racket-scoundrel`
("when you Feint, your foe is off-guard to all your attacks") — a core PF2e verb this engine didn't
have before. Feint sets an off-guard flag consumed by the hunted-prey OR reloaded condition
`crossbow-ace` also checks.

**A reload mechanic exists**, however minimal, unlocking `crossbow-ace` honestly: the `reload-1`
trait on the Crossbow item now actually costs an action to clear before the next Strike works at
full effect.

**The `mountSaveBar` cleanup is done.** The old hand-rolled Export button and `App.exportSave()` are
gone; the save bar is mounted via `mountSaveBar(..., {buttons: ["export","import"], filename: () =>
...})`, naming the file after the hero.

**A real repo-wide bug was found here and reported, not fixed locally: `sync-social-tags.mjs`'s
permanent false DRIFT.** Reported alongside fifteen other projects' identical finding; root-caused
and fixed by prompt 22 this round (a Windows/`autocrlf` line-ending mismatch, `gvb-site-handoff-v10.md`
§3) — not a bug in this project's own `torchbearer.html`.

**A `.claude/launch.json` change landed this round, with Devon's live sign-off**: the
`gvb-static-site` config's `autoPort` is `true` now, `runtimeArgs` no longer hardcodes a port. Not
routed through the shared-file-request process since it happened live in-session — flagged here so
it's not mistaken for an out-of-process change.

**`content-authoring-guide.md`** documents the Feint/reload mechanics now. **`mobility`,
`racket-scoundrel`'s off-guard condition, and `crossbow-ace` are the only hooks still meaningfully
gated** — see task list.

**`Projects/torchbearer/test/smoke.mjs`, 95 checks**, unchanged — this round's `Combat`/`App`
changes live entirely in browser-only code the Node suite doesn't import.

**The `Pathfinder/data/` question is still unresolved** — raised again this round, a sixth time
site-wide (jointly with The Absalom Inheritance). See prompt 01's "Questions for Devon" block,
which tracks this centrally.

## Your task

Round 3 wired all three feature items round 2 left open. What's left:

1. **`mobility` — still not just unwired, but currently unwireable.**
   `Combat.provokeAlong()` only ever fires a reactive strike against a moving *foe*, never against
   the hero or a companion, and no monster in the Registry carries `reactive-strike` either.
   Wiring the special up today would be a flag nothing reads. The real prerequisite is giving at
   least one monster a reach reaction — a monster-data question, not this hook. Don't attempt this
   without that first.
2. **A stale comment in `loadSave`'s "Content Missing" branch** describes the old save-order
   behavior that `mountSaveBar`'s cleanup changed. Small, self-contained, real — a documentation
   fix, not urgent.
3. **`Pathfinder/data/`** — still not yours to decide alone. See prompt 01's "Questions for Devon"
   block. Don't build a runtime dependency on it.
4. **If your own pass finds nothing beyond the three items above, say so plainly.** This project
   has now had three consecutive rounds of real feature and bug work, and every previously-inert
   hook except `mobility` is wired; a session that confirms there's nothing left but a blocked item
   and a comment fix is a legitimate, valuable outcome — not a failure to find scope.

## Verification

- `node Projects/torchbearer/test/smoke.mjs` → **95 passed, 0 failed**.
- Open the page in a real browser. Load a pack from the Shelf, play it in, export a hero,
  clear storage, import it back, confirm you get the same state. Try a deliberately corrupt
  `.torchsave.json` and confirm the running game survives it.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken**, 0
  collisions across nine widths, tightest vertical gap 9.1px. (The unit count moves every round as
  files are added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round; the
  false-DRIFT this project reported is fixed at the root, see above).
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**.
- `npm run games` → your game has a real entry (7 checks — a 2D DOM game, not three.js, so it isn't
  affected by locked decision #53's rendering-speed finding). Part of the fair-environment run that
  reported **146 checks, 0 failed** across the whole suite this refresh (`gvb-site-handoff-v10.md` §6).
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and
  watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible
browser windows, and Chrome throttles a window that loses focus. Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/10-torchbearer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v*.md` gets assembled from all twenty-two of them each round.

Use these headings:

```
# Torchbearer — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths.
- **What I verified** — actual commands, actual output. Include the export/import round trip
  and the corrupt-file test. "Should work" is not verification.
- **Shared-file requests** — anything you need from `Pathfinder/data/`, any `gvb-save.js` gap with
  the exact hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something
was wrong, say what was wrong and what the evidence was. Match that. Do not write
"comprehensive" or "robust" anywhere.
