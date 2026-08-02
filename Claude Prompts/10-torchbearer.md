# 10 — Torchbearer

You are working on Torchbearer, a Pathfinder 2e adventure engine on greyversusblue.com. It
is a single-file game that loads user-supplied adventure content, and it carries
`class="has-suite"` on the board — it advertises itself as a platform, not one adventure.
Round 2 fixed Assurance, fixed a real potion-healing bug, fixed a Shield Block double-grant
hole, and committed a real playthrough save that — combined with prompt 21's work this round —
finally gave this game a preview, an OG card, and an `npm run games` entry. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/torchbearer.html` (3,280 lines)
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
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. Now has `data-preview` pointing at your game — see below. |
| `Pathfinder/**` | Prompts 01, 02, 03. `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't create a runtime dependency on it. Whether that data is a shared interface or private to prompts 01-03 is a real open question — see prompt 01's "Questions for Devon" block, which now tracks it centrally. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/torchbearer.jpg`, `assets/og/torchbearer.jpg` | Generated. Prompt 21. **These exist now** — 9.2 KB / 64.4 KB, captured this round from your committed save. |
| `Tools/board-check/**`, including your new `play-games.mjs` entry (7 checks) and `games.mjs` recipe | Shared dev tooling. Prompt 21. |
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
2. **`Claude Prompts/notes/10-torchbearer-notes.md`** — round 2's session: fixed Assurance
   (two bugs, not one), decided and fixed the potion-heal bug (a real, reachable bug — every
   Lesser Healing Potion in the game was silently healing about 10 HP short of its own text),
   fixed Shield Block double-granting, fixed `surprise-attack`, and played the builder for real to
   commit a save fixture. Round 1's notes are archived at
   `Claude Prompts/archive/round-1/notes/10-torchbearer-notes.md`.
3. `Projects/torchbearer/content-authoring-guide.md` — the contract between the engine and its
   content, updated this round to move `assurance` and `surprise-attack` into the working list
   and give the four remaining inert hooks specific findings instead of "flavour only."
4. Both JSON packs in `Projects/torchbearer/packs/`, as worked examples of that contract.
5. `gvb-site-handoff-v9.md` §5 (your preview/OG/games.mjs entry, finally unblocked and applied
   this round) and §10 (locked decisions #51-53).
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

3,280 lines in one file. Title: "Torchbearer — A Pathfinder 2e Adventure Engine". Tagged `CRPG`
with `has-suite` on the board. **Now has a preview and an OG card** (round 2 committed a real
playthrough save; prompt 21 used it this round to build the `games.mjs` recipe, capture, and
promote — 9.2 KB preview, 64.4 KB OG card).

**Assurance works.** Two bugs, not one: `finalizeCharacter` only ever recorded the bare string
`"assurance"`, so Assurance (Athletics) and Assurance (Arcana) were indistinguishable — fixed by
keying it `"assurance-"+skill`. And nothing consumed it — `choose()`'s scene-check path now offers
a modal (forgo the roll for `10 + proficiency`, or roll normally) whenever the hero has Assurance
for the relevant skill.

**The potion `heal` question is decided: read the item, don't rewrite the item.** Both core
potions kept their existing text; the engine was changed to match. `resources.potions` is now a
stack of item ids (was a bare count), so Drink Potion rolls the specific item's own `heal` formula.
This was a real, reachable bug: Bell of Barrowmoor and Thornwake Vigil both hand out Lesser Healing
Potions, and every one healed a flat `1d8` instead of the advertised `2d8+5` — about 10 HP short,
every single time, silently.

**`surprise-attack` works now** — a second inert hook fixed past what was asked, because the
scaffolding was already 90% there: "creatures that haven't acted are off-guard to you," one added
clause in `Combat.effAC`.

**Shield Block is greyed out where a class already grants it**, closing the follow-on hole from
round 1's `grantFeat` fix (which made classes actually grant it, but left the general-feat picker
still offering it a second time).

**A real committed save fixture exists**: `Projects/torchbearer/test/sera-voss.torchsave.json` —
played for real, not built blind (Dwarf Fighter, Farmhand background, Thornwake Vigil, mid-combat
at the Vanguard's Watch). `test/smoke.mjs` asserts it deserializes with the expected hero,
adventure, and scene, so it can't silently rot.

**`content-authoring-guide.md`** now documents 37 working hooks (was 35) and gives the four
remaining inert ones (`mobility`, `edge-outwit`, `racket-scoundrel`, `crossbow-ace`) specific,
actionable findings instead of a blanket "flavour only" — see task list below.

**`Projects/torchbearer/test/smoke.mjs`, 95 checks** (was 86), exits non-zero on failure.

**The `Pathfinder/data/` question is still unresolved** — raised again this round, a fourth and
fifth time site-wide (jointly with The Absalom Inheritance). See prompt 01's "Questions for Devon"
block, which now tracks this centrally rather than each project re-raising it independently.

## Your task

Round 2 closed the headline preview gap and fixed two real gameplay bugs plus one extra. What's
left is genuine feature work on the four remaining inert hooks — each one is now a specific,
scoped finding, not a vague "flavour only":

1. **`edge-outwit`'s AC half, paired with Demoralize's bonus against hunted prey.** The feat is one
   clause ("+1 AC *and* +2 to Deception/Intimidation/Stealth against your prey") — the AC half is
   safe to add alone (one more term in `effAC`), but shipping half of it silently makes the guide's
   "these are inert" table wrong about the other half. Demoralize (Intimidation) already exists as
   an action and could take the bonus immediately; Deception/Stealth need a Feint and/or Hide action
   that doesn't exist yet (see next item) — either build those too, or say explicitly in the guide
   that they stay unbonused until then.
2. **A Feint action.** Unlocks `racket-scoundrel` ("when you Feint, your foe is off-guard to all
   your attacks" — no verb to attach to right now, since there's no Feint button or
   `resolveTargeted` case for it) and is probably worth more than that one feat alone — Feint is a
   core PF2e verb this engine doesn't have yet. Twin Feint (a different, already-working feat) does
   something narrower and isn't a substitute.
3. **A reload mechanic, however minimal.** Unlocks `crossbow-ace` honestly — the `reload-1` trait is
   already on the Crossbow item, but nothing currently spends an action reloading, so Strike with a
   loaded crossbow just works every turn with no reload step to track. Shipping the feat's
   hunted-prey bonus alone without "or after reloading" would be inconsistent with its own wording.
4. **`mobility` — investigated, and it's not just unwired, it's currently unwireable.**
   `Combat.provokeAlong()` only ever fires a reactive strike against a moving *foe*, never against
   the hero or a companion, and no monster in the Registry carries `reactive-strike` either.
   Wiring the special up today would be a flag nothing reads. The real prerequisite is giving at
   least one monster a reach reaction — a monster-data question, not this hook. Don't attempt this
   without that first.
5. **The `mountSaveBar` cleanup, low priority.** Swap the hand-rolled Export button for
   `mountSaveBar(..., {buttons: ["export", "import"], filename: () => ...})` now that the module
   supports naming the file after the hero. The hand-rolled version works correctly today; this is
   tidiness, not a fix.
6. **`Pathfinder/data/`** — still not yours to decide alone. See prompt 01's "Questions for Devon"
   block. Don't build a runtime dependency on it.

## Verification

- `node Projects/torchbearer/test/smoke.mjs` → **95 passed, 0 failed**.
- Open the page in a real browser. Load a pack from the Shelf, play it in, export a hero,
  clear storage, import it back, confirm you get the same state. Try a deliberately corrupt
  `.torchsave.json` and confirm the running game survives it.
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken**, 0
  collisions across nine widths, tightest vertical gap 3.5px.
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**.
- `npm run games` → your game has a real entry now (7 checks, 0 failed as of this round — a 2D DOM
  game, not three.js, so it isn't affected by locked decision #53's rendering-speed finding).
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and
  watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible
browser windows, and Chrome throttles a window that loses focus. Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/10-torchbearer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v*.md` gets assembled from all twenty-one of them each round.

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
