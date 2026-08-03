# The Absalom Inheritance — session notes

Round three. Priority 1 from round two's own list, unchanged: one fixed PC, no build, no choice
outside tactics. That gap is closed — `pc` is now `pcOptions`, an array of two buildable
characters, picked on a screen shown once before there is a save to load.

---

## What changed

### Character creation: `pcOptions`, `selectPc()`, and a picker screen

`content/vault.json`'s single `pc` object is now `pcOptions`, an array of two builds:

- **Vesper Quill, Human Wizard 1** — the original PC, numbers and command list untouched
  (`strike`, `shield`, `splash`, `breathe`, `fang`, `potion`).
- **Kessa Vane, Human Fighter 1** — new. No spells (`slots`/`focus` both 0), a new global command
  `strike-sword` (Strike — Longsword, attackBonus 7, `1d8+2`, non-agile so MAP is the standard
  −5/−10), and `potion`. The heirloom longsword has sat in every PC's satchel since round one as
  pure flavour text (`startingInventory` never changed); this is the first build that can actually
  swing it.

**The engine did not get a "which build" concept at all, and that was deliberate.** `js/content.js`
exports `selectPc(content, buildId)`, which resolves one build's stats onto `content.pc` and
narrows `content.commands`/`commandById` down to exactly that build's own list. Every module that
reads `content.pc` — `game.js`, `save.js`, `render.js`, `ui.js`, `test/autopilot.mjs` — still reads
it exactly as if there were only ever one PC, because by the time any of them see `content` it has
already been resolved. **None of `game.js`, `render.js` changed at all.** `game.js` got one line
(`buildId: content.pc.id` in its own internal `freshState()`, for shape parity with save.js — that
internal fallback is only ever exercised by ad hoc test games, never by the real boot path).

The filtering matters for correctness, not just tidiness: without it, a Fighter given the base
pack's full `commandById` could cast the Wizard's Shield cantrip for free, since `commandBlocked()`
only checks resource costs (a slot, a focus point, an item), and Shield spends none. Narrowing
`commands` to a build's own list is what actually stops that.

**`content.pc` defaults to `pcOptions[0]` for a caller that hasn't chosen yet, and `pcOptions[0]`
has to stay the wizard.** A save written before this round has no `buildId` field at all — every
save that could exist before today implicitly meant the one PC that ever existed — and
`save.js`'s `repair` falls back to `pcOptions[0]` for exactly that reason. Reordering the array
would silently change what a round-one or round-two save becomes on next load.

**The picker itself** (`js/ui.js`'s new `pickCharacter(content)`, plus a new `#create-veil` modal
in `absalom_inheritance.html`) is built entirely from `content.pcOptions` — name, title, blurb,
HP/AC/Speed/saves, and the build's own command names (looked up through `commandById` so the card
shows "Strike — Longsword," not the id `strike-sword`). A third build needs no matching edit here.
It has no `data-close` and isn't in the Escape-closes-any-modal exclusion list in `ui.js`'s keydown
handler — not because I added a special case, but because `mountUI()` (which wires that handler) is
now called *after* the picker resolves, so there is nothing to close prematurely.

**`main.js`'s boot sequence**: fetch the pack (unresolved, every build); load a save if one exists;
if not, `await pickCharacter(pack)` and build a fresh state via `slot.fresh(buildId)` — which
reaches `save.js`'s `freshRun(content, buildId)` because gvb-save's `fresh()`/`reset()` already
forward their own arguments straight through to the `defaults` factory (that passthrough existed
for The Fourth Quarter's `newCampaign()`; this is the second thing that's ever used it). Then
`selectPc(pack, state.buildId)` once, and everything after that — `createGame`, the renderer,
`mountUI` — is handed the resolved content and is unaware a choice was ever made.

**"Start over" now clears rather than resets.** `main.js`'s `onReset()` used to call `slot.reset()`
(write a fresh default-build state, then reload). With more than one build that's wrong — it would
silently restart as `pcOptions[0]` with no chance to pick again. It now calls `slot.clear()` and
reloads with nothing written, so the picker fires on the next boot exactly like a first visit.
That meant **removing `"reset"` from `mountSaveBar`'s button list** (its built-in reset button
calls `slot.reset()` with no way to intercept between the clear and the fresh-state write) and
adding my own `#btn-restart` in the left panel that calls the same `onReset()` the end-of-game
modal's "Start over" already used — one reset behaviour, reachable from two places, instead of two
behaviours that used to agree by coincidence (both defaulted to the only build there was).

### `save.js`: `buildId`, and repair resolving it before it can clamp anything

`run.buildId` is a new top-level field, alongside `packId`/`areaId`. `repairRun()` resolves it
first — falling back to `pcOptions[0].id` if missing or unknown — *before* it clamps `pc.hp`,
`pc.slots` or `pc.focus`, because those maxima are now per-build (`24` HP and `0` slots for the
fighter vs `15` HP and `2` slots for the wizard; ended up shipping the fighter at `18` HP after
balance, see below). `freshRun(content, buildId)` takes the build id explicitly now.

### `test/autopilot.mjs`: generic over *kind*, not hardcoded ids

The old `combatPolicy()` was written as `if (!game.commandBlocked("breathe"))` — fine when there
was exactly one possible set of command ids. The fighter's attack is `strike-sword`, not `strike`,
and has no cone, no unerring hit, no self-buff at all. A new `findUsable(game, kind)` helper scans
`game.content.commands` (already narrowed by `selectPc`) for the first usable command of a given
`kind`, and `combatPolicy()` now asks for `"cone"`, `"unerring"`, `"attack"`, `"self-buff"` rather
than specific ids. `test/balance.mjs` runs the wizard and the fighter through the *same* policy
function with no branch anywhere that says "if this is the fighter." A third build with an honest
`kind` on its commands needs no autopilot changes at all.

### `test/balance.mjs`: one report per build, both gated

Loops `basePack.pcOptions`, resolves each with `selectPc`, runs 2000 seeded seeds, reports and
band-checks each independently, and exits non-zero if *either* is out of band.

---

## What I verified

**Both builds, 2000 seeded runs each:**

```
node Projects/absalom-inheritance/test/balance.mjs 2000
  wizard:  53.6% (identical to round two's own number — confirms the autopilot
           refactor and the content.js reshape didn't move the wizard's numbers at all)
  fighter: 79.8% (band 45-90%)
```

The fighter needed real tuning, not just a stat block written by feel. First pass (HP 24, AC 18,
attackBonus 9, `1d8+4`) measured **99.5%** over 2000 runs — the sentinels almost never landed a hit
(damage taken mean 5.8) because AC 18 is above everything in the vault's to-hit range. Dropped to
HP 18 / AC 14 / attackBonus 7 / `1d8+2` and re-measured **93.6%**, still out of band, before landing
on the shipped numbers at 79.8%. Three iterations, not one — the same lesson round two's own guide
already states about the reliquary warden: measure, don't reason from the stat block.

**`node test/smoke.mjs` → 308 passed, 0 failed** (was 281). New coverage: `pcOptions` validation
(empty array refused, missing id refused, duplicate ids refused, a build listing an unknown command
refused), `selectPc()` narrowing commands correctly both ways (a build can't see a command outside
its own list, and can see everything inside it), the unknown-buildId fallback, `repair()` resolving
`buildId` before clamping (a legacy save with none migrates to `wizard`; a fighter save clamps
against 18 HP / 0 slots, not the wizard's 15 / 2), `slot.fresh(buildId)` forwarding the pick through
gvb-save's existing args-passthrough, and a full 40-seed `playThrough()` for the fighter build
confirming it actually reaches and fights every seed (not just "loads without throwing").

**Played it, in a real browser, via the DOM and dispatched events** (this environment's
`computer{action:"screenshot"}` / `computer{action:"key"}` paths are unreliable here — round two's
notes flagged screenshot and key specifically; this round `computer{action:"left_click"}` on the
picker's own button also did not register, confirmed by re-reading the DOM afterward and finding
nothing changed. Dispatching a real `MouseEvent` from script worked immediately, so that's the
verification path below, consistent with locked decision #39):

- Fresh boot with no save: picker renders both builds correctly — name, title, blurb, HP/AC/Speed,
  all three saves, and the command list resolved to actual names ("Strike — Longsword · Drink
  Healing Potion" for the fighter, not raw ids).
- Clicked "Begin as Vesper Quill" via a dispatched `MouseEvent`: booted as the wizard, `buildId`
  "wizard," HP 15, character sheet correct, command panel showed exactly the wizard's six buttons
  plus End Turn.
- Saved mid-run (`slot.save(game.snapshot())`), reloaded cold: booted straight back into the saved
  position with no picker shown, "Save loaded" message — the loaded-save branch correctly skips
  character creation.
- Wrote a hand-built **legacy save with no `buildId` field at all** directly into `localStorage`,
  reloaded: migrated onto `wizard` (Vesper Quill on the sheet), HP/slots preserved from the legacy
  save, picker correctly skipped. This is the exact migration path a real round-one or round-two
  save in the wild would hit.
- Clicked "Start Over": save cleared, picker re-shown on reload. Picked Kessa Vane: booted as
  fighter, buildId "fighter," HP 18, AC 14, zero slot/focus gems drawn (both cap at 0), command
  panel showed exactly `strike-sword` + `potion` + End Turn.
- **Fought a real encounter as the fighter, through `useCommand("strike-sword", …)`** (not the
  autopilot — the actual player-facing call): walked into a sentinel's notice radius, fought it to
  death, log showed "Strike — Longsword vs Shattered Sentinel (AC 13) — CRITICAL SUCCESS ...
  1d8(6)+2 = 8 ×2 (crit) = 16," sentinel died, combat ended cleanly, HP/stats tracked correctly.
- **Mobile, 375×812**: picker cards stack to one column at 297px wide, no horizontal overflow.

**Repo sweeps**

```
cd Tools/board-check && npm run check
  → 358 units checked, 0 broken; 0 collisions across nine widths, tightest vertical gap 9.1px

npm run social:check
  → 6 pages out of sync (daredevil, torchbearer, fourth-quarter, Ren-Faire-Claude, orbital,
    newindex.html) — none of them mention "absalom," none of them are in my boundary. Same
    pattern round two's own notes recorded: other concurrent sessions' files, not mine to fix.
```

---

## Shared-file requests

**Nothing needed.** No board `href` change, no `gvb-save.js` gap — `fresh()`/`reset()`'s existing
args-passthrough already covered passing a `buildId` through; nothing about character creation
needed a new hook. No preview/OG update — nothing about the picker screen belongs in a mid-combat
capture. The `npm run social:check` drift above is informational only, not a request; it's outside
`Projects/absalom-inheritance/` and `Projects/absalom_inheritance.html` entirely.

---

## Deliberately not done

**Reactions (Shield Block, Attack of Opportunity) and the true cone template** — priorities 2 and 3
from round two's list, untouched. Character creation alone touched eight files (`content.js`,
`vault.json`, `save.js`, `game.js` one line, `autopilot.mjs`, `balance.mjs`, `main.js`, `ui.js`,
plus the HTML shell) and needed three balance-tuning passes on the fighter before it landed in
band; stacking a turn-loop interrupt point on top in the same session would have meant shipping at
least one of the two unverified.

**A third build.** Two is enough to prove the mechanism (`selectPc`, the generic autopilot, the
picker) works for more than one, and `content-authoring-guide.md` §3 now documents exactly what a
third one costs: an entry in `pcOptions`, a `commands` list naming ids that already exist (or new
global commands if it needs its own, the way the fighter needed `strike-sword`), and a
`balance.mjs` run to tune it — no engine file changes required unless the new build needs a
genuinely new command *kind* the engine doesn't have yet (a heal-over-time, say).

**Per-build inventory or per-build starting gear.** Both builds share `startingInventory` — the
fighter's whole reason to exist as a build is that the longsword was already sitting in everyone's
satchel unused. A build that wanted its own gear list (different starting potions, no spellbook for
a non-caster) would need `startingInventory` to move from pack-level to per-build, which is a real
content-schema change I didn't need for two builds that are happy sharing one satchel.

**Per-build renderer distinction.** The PC always draws in the same blue palette on the board
regardless of build. Cosmetic, and `render.js` staying untouched was one of the two files this
round proved didn't need to change at all — not worth reopening for a color swap.

**The `Pathfinder/data/` question** — still open, still not touched, still Devon's call. Nothing
in character creation reads or depends on it.

---

## Next session

1. **Reactions** (Shield Block, Attack of Opportunity). Still needs a real interrupt point in the
   turn loop that doesn't exist yet. Two builds now exist to re-verify against — Attack of
   Opportunity in particular is a fighter-flavored ability this vignette doesn't have yet despite
   shipping a fighter, and it's the more natural build to hang it off of. Re-run `balance.mjs` for
   *both* builds afterward, not just one.
2. **A true PF2e cone template.** Roughly 30 lines per the original estimate, still true. Wizard-only
   at present (the fighter has no cone), so this only needs one build's balance re-verified.
3. **A third build**, if Devon wants one — cheap now that the mechanism exists. A support/skill
   build (Rogue, Cleric) would exercise a `kind` the engine doesn't have yet (a heal that isn't
   `self-heal`, a debuff) more than another striker would.
4. **Per-build starting inventory**, only if a future build's flavor actually needs different gear
   rather than a different subset of the shared satchel — don't build it speculatively.
5. **A hint-bar line on area transition** — round two's own leftover, still true, still cosmetic,
   still only worth doing if a session is already in `ui.js`'s event handler for something else.
6. **The `Pathfinder/data/` question** — cheaper to decide before a fourth prompt round assumes an
   answer either way.

**How much game is there now?** Same two rooms, same four mandatory fights, same 12–16 minutes —
character creation adds replay value, not new content. The honest framing for anyone asking "what's
different": the adventure itself is identical to round two; what changed is that there are now two
different ways to play through it, tuned separately, and the second one (79.8%) is meaningfully
easier than the first (53.6%) — a deliberate asymmetry ("simpler but hits harder" per its own
blurb), not an oversight, but worth knowing before assuming both builds are an equally hard vault.

**Is the app stable?** Yes. `node test/smoke.mjs` (308/308) and `node test/balance.mjs 2000` (both
builds in band) both pass clean, the browser playthrough above covered a fresh boot, a save/reload,
a legacy-save migration, a start-over/re-pick cycle, and a real fight through the new build's own
command — not just the autopilot — and the repo-wide sweeps found nothing in this session's
boundary. No outstanding bugs, no unverified guard-rail, no task left mid-flight from this round.
