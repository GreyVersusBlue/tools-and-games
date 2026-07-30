# The Absalom Inheritance — session notes

First session this game has ever had. The prompt's default plan was "adopt `gvb-save.js` and give
it a save", and the audit did change my mind about the order: **the game could not be won.** Not
"was hard" — could not be finished on any seed. Everything else was downstream of that, including
the save, because a save is a way to leave a long game and come back, and there was no long game.

So: the balance got fixed first, the save landed second, and both needed the same thing to exist
before either was possible — a rules engine that runs under Node so a machine could count.

---

## What changed

### The audit, before any code

Played it end to end in a real browser. Five findings, all measured:

1. **Unwinnable.** Two "Shattered Sentinels" at Creature 0 (17 HP, AC 14, fist +6 for 1d6+2)
   woke *together* the moment either one saw you, then put six attacks a round into a 15 HP
   level-1 wizard with two spell slots. My first playthrough died in the first round of the fight
   having dealt 4 of the 34 damage needed. Later, with a harness that could count: **0 wins in
   2000 runs.**

   Against PF2e's own budget this is not close. A one-PC party's moderate encounter is 20 XP; two
   level-0 creatures is 30 XP, which is past severe. The statlines were not the problem — the
   *count* was.

2. **No game board below 900px wide.** The body was a fixed `260px 1fr 320px` grid with **zero
   media queries**. At 375×812 the middle column computed to exactly **0px**: character sheet, a
   sliver of log, and no map at all. `overflow:hidden` meant you could not even scroll to the
   580px of panels.

3. **The renderer measured itself once and could never recover.** `resize()` read `clientWidth`
   at boot and then only on a `window.resize` event. Caught on a real page load with a **700×720
   canvas and a 0×0 backing store**, `originX` of 0, and every tile drawn off the left edge. Any
   first layout that has not happened yet, any container resize that is not a window resize, any
   devicePixelRatio change, and the projection is permanently wrong with no path back.

4. **Unplayable by keyboard.** Seven focusable buttons; the canvas had `tabIndex -1`, no
   `aria-label`, and the only key handlers were `i` and `Escape`. Moving, targeting and reading a
   pillar were all canvas clicks, so six of those seven buttons were dead ends without a mouse.
   Not "awkward" — the adventure was unfinishable.

5. **No persistence at all**, as the prompt said. Confirmed: zero `localStorage` calls.

### Restructured, but the URL did not move

`Projects/absalom_inheritance.html` is still where it was and is still what the board links to.
It is now a shell — chrome, CSS, element ids — and everything else is ES modules under
`Projects/absalom-inheritance/`. **No board edit was needed, no shared-file request for an
`href`, nothing for anyone else to apply.**

The prompt offered `Projects/absalom-inheritance/index.html` and noted it breaks the URL. I did
not take it. Keeping the URL and moving only the insides gets the whole benefit of the split —
Node-testable logic, a content format, a real test suite — at zero cost to anyone's bookmark and
zero risk of handing forward a `npm run check` that fails until prompt 21 catches up. The
underscore-versus-hyphen inconsistency is still there in the filename; that is the price, and it
is a smaller price than a dead link.

1,190 lines in one file became 3,655 across twelve files plus a 430-line shell:

| Path | Lines | What |
| --- | --- | --- |
| `js/rules.js` | 145 | PF2e math. Pure, RNG injected. |
| `js/world.js` | 179 | grid, line of sight, A* with diagonal parity in the node key |
| `js/content.js` | 226 | load and validate a pack; refuse a broken one |
| `js/game.js` | 731 | the run: state, turns, triggers, commands. Headless. |
| `js/save.js` | 198 | the `gvb-save` slot, and `repair` |
| `js/render.js` | 282 | isometric canvas renderer |
| `js/ui.js` | 534 | panels, log, modals, keyboard, save bar |
| `js/main.js` | 80 | boot and wiring |
| `content/vault.json` | 256 | the adventure as data |
| `test/smoke.mjs` | 730 | 244 assertions |
| `test/balance.mjs` | 102 | Monte Carlo playthroughs |
| `test/autopilot.mjs` | 192 | a competent player, shared by both suites |

The five logic modules run under plain Node with no DOM. That is the load-bearing part: nothing
in the rules waits on a `setTimeout` any more. The old build animated *inside* the rules —
`walkPath` was `async` and awaited 90ms per square while triggers fired — so a throttled tab
could interleave with its own turn resolution. Now the engine resolves a creature's whole turn
instantly and hands back a script of what it did; `ui.js` paces the playback. Given v7 §6
(Chrome throttles a window nobody is looking at), a game whose rules cannot be raced by its own
animation is worth the refactor on its own.

### The save

**Storage key: `absalom-inheritance-save-v1`. Schema version 1. That key is now permanent**
(locked decision #36). I used the repo's existing convention — `integer-foundry-save-v1`,
`aphelion-save-v1` — rather than the prompt's suggested `absalom-save-v1`, so it matches the two
neighbours instead of inventing a third shape.

Through `assets/js/gvb-save.js`, imported relatively (`../../../assets/js/gvb-save.js`) so the
Node suite can resolve it. `defaults` is a factory, per the prompt's warning — not because
character generation is randomised (it is not, yet) but because a literal is how The Fourth
Quarter's `reset()` came back `null`, and the smoke suite asserts `reset()` twice returns two
different objects.

`repair`, not `migrate`, does all the filling in — `migrate` is empty because version 1 is the
first version. `repair` clamps or rebuilds **every** field from content, including ones that
cannot be missing today, because the version where they can is the entire reason the hook exists.
Two of its rules came out of thinking about the v7 §2 trap directly:

- **A creature with no Speed gets a number, never `undefined`.** An `undefined` Speed here does
  not crash — it paths zero feet and stands still forever. Same shape as the staffer whose
  missing walking speed became a NaN and made a floor NPC that never arrived anywhere.
- **Clamping a wild coordinate into bounds is not enough.** `x: 900` clamps to 21, which on this
  map is the border wall, and a PC inside a wall can never path anywhere again. Any position that
  is not somewhere a body can stand goes back to the spawn. Same for creatures. I only noticed
  because a test asserted the spawn and got the wall.

The fog-of-war memory is a 484-character `"0"`/`"1"` bitfield rather than a set of `"x,y"`
strings: 484 bytes instead of about 3 KB, readable in a hand-inspected save, and it does not grow
a JSON key per square. `repair` throws it away if the length no longer matches the area, because
indexing a bitfield with the wrong stride is worse than forgetting the map.

**The save bar is in the left panel, on the board, reachable on every turn** — not behind a title
screen. v7 §9 has an item open precisely because The Fourth Quarter's is only on its start
overlay. This game has no title screen to hide it behind, so that item does not reproduce here.

A save restored mid-encounter re-rolls initiative. Rebuilding a half-finished round is more
machinery than it is worth; and a player who reloads to dodge bad initiative could equally reload
to dodge a bad damage roll, which is inherent to autosaving a dice game in a browser rather than
something this design introduced. Written down rather than papered over.

### The balance, measured rather than argued

`test/balance.mjs` plays the whole adventure with a seeded RNG and an autopilot that fights
everything and never uses cover. Four changes, each measured, and **two of the four were not what
reading the stat blocks would predict**:

| Change | Win rate |
| --- | --- |
| shipped build | **0%** (0 of 2000) |
| sentinels woken one at a time; dropped to Creature -1 (11 HP, AC 13, fist +4 for 1d6) | 10.7% |
| three healing potions instead of two; the Keeper's statline retuned | 29.6% |
| opening the gate restores HP as well as slots and focus | 40.8% |
| **a bug the harness found — see below** | **59.3%** |

The single most valuable change was not a number. **Waking one sentinel at a time** turned one
1v2 rout into two sequential 1v1 fights, and it is also just more honest: constructs do not
telepathically alert each other. A dormant creature is drawn with an unlit eye, so which of them
has seen you is readable on the board.

The binding constraint was never a statline. It was that **a solo level-1 wizard's entire day is
two spell slots and one focus point**, and the adventure was asking three encounters of it. The
gate's restore is what makes it two acts instead of one long one, and it is the reason the boss
is a fight rather than a formality. Everything comes back at the gate except potions, which makes
potions the currency the delve is actually played in — and rewards a player who slips past a
sentinel using the wall blocks as cover, because they arrive holding all three.

**The Keeper is the old statline, promoted.** The 17 HP / AC 14 / +6 / 1d6+2 the two sentinels
originally shared is now one boss (at 18 HP, AC 14, +4, speed 15) standing behind the casket
past the gate, fought by a refreshed PC. 15 XP against a solo level-1 PC. The number was never
wrong; it was pointed at the wrong fight, twice over.

**The bug the harness found, which was not a balance problem at all:** 33% of runs were killing
the Keeper *while standing on the casket* and never being told they had won. The win was checked
only on movement, and the treasure chamber is four squares by four with two of them casket, so
"kill the boss standing on the lid" is the common case rather than a corner. Winning is a
standing condition now — checked on every step, on any creature's death, when an encounter ends,
and on boot, because a save can have been written with the PC already on an unguarded casket.
One browser playthrough would never have found this. Counting found it in one run of the harness.

Also added because the sim made the gap obvious: **Shield** (the cantrip, 1 action, +1
circumstance AC until your next turn). The PC had exactly one 1-action offensive option and it
required adjacency, so a spare action was routinely worth nothing. It also gives a keyboard
player something to do with a leftover action.

### Content is data now

`content/vault.json` holds the map (ASCII rows plus a legend), creature statblocks, commands,
items, lore, the gate and treasure conditions, and the tuning numbers. `js/content.js` validates
it and **rejects a broken pack whole**, naming the field. Damage is written the way a stat block
writes it (`"1d6+2"`) and a string the parser cannot read *throws at load* — `"1d6+"` used to be
a sentinel that hit for nothing.

`content-authoring-guide.md` documents all of it, following the precedent of Torchbearer's guide
next door. Two things I copied deliberately from that file's audit note: every departure from the
rules is flagged next to the number it affects, and the one knob that is loaded but not yet read
by anything (`tuning.standardDC`) is called out as such rather than left to look wired.

The character sheet, the command buttons, the spell-slot gems and the focus gems are all built
from the pack at boot, so the sheet cannot drift from the rules the engine is applying. Lore body
text is escaped, not injected as HTML; the old build interpolated raw HTML into the modal and
there is no reason content needs that power.

### Mobile

Below 900px the three columns collapse to one stack with a Sheet / Board / Log tab bar. The board
gets the full viewport width. At 375×812 the whole 22×22 map fits with all four corners reachable,
and `document.body.scrollWidth` equals 375 — no horizontal overflow.

### Keyboard

The adventure is finishable with no pointer at all. Arrows or WASD move a cursor (Home/PgUp/End/
PgDn for the isometric diagonals), Enter acts on it, Tab cycles between visible creatures, unread
pillars and the casket, number keys fire commands, `E` ends the turn, `I` opens the satchel,
`Escape` cancels an armed command or closes a modal. Satchel items move with the arrow keys and
discard with Delete, so reordering is not drag-only. Modals are `role="dialog"`, take focus, and
return it. A polite live region announces what the cursor is over ("Shattered Sentinel, 11 of 11
HP, dormant").

### The renderer

`syncSize()` runs every frame and compares against **the backing store itself**, not a cached
copy of the CSS box — caching the box catches the boot race but not a backing store that went
wrong some other way, and a renderer that cannot notice its own canvas is the wrong size is the
bug it exists for. Tile size is computed to fit the viewport instead of fixed at 56×28, which is
what makes 375px work. The cone is painted before you commit it, so a ±45° approximation is
something you aim rather than guess.

---

## What I verified

Everything below is a command I ran or a browser assertion I made. Screenshots were not available
this session — the Browser pane never composited, so `computer{action:"screenshot"}` timed out
every time. Everything visual was verified by asserting against the DOM and the live projection
instead, which locked decision #39 prefers anyway for anything that just happened.

**Node suites**

```
node Projects/absalom-inheritance/test/smoke.mjs
  → 244 passed, 0 failed — SMOKE OK

node Projects/absalom-inheritance/test/balance.mjs 2000
  → victory 1185 (59.3%) · defeat 815 (40.8%)
    reached both pillars 84.8% · opened the gate 84.8%
    creatures slain mean 2.42 of 3 · encounter rounds median 10
    damage dealt/taken mean 42.9 / 20.1
    on a win: HP left mean 9.9 of 15 · potions left mean 1.69
  → BALANCE OK — 59.3% (band 45–90%)
```

`balance.mjs` exits non-zero outside the band, so a content edit that makes the adventure
unwinnable fails the build rather than shipping. The band is wide (45–90%) on purpose: it guards
against "unwinnable" and "free", not against a decimal point. A tight band is a guard-rail people
delete.

**Repo sweeps**

```
cd Tools/board-check && npm run check
  → integrity: 271 units checked, 0 broken
  → collisions: 0 collisions across nine widths, tightest vertical gap 7.1px

npm run social:check
  → 23 notices · 23 already current · 0 out of date · 0 failed
```

Baseline before I started was 235 units; it is 271 now, but that is not all mine — several other
projects gained files while I was working. The number that matters is 0 broken. `social:check`
being clean confirms I did not touch anything inside the `gvb:social` markers.

**Guard-rails verified by reintroducing the bug they guard** (locked decision #34)

- Canvas sizing: set `canvas.width = 0; canvas.height = 0` on a live page — the exact failure
  observed in the original — then drew one frame. Backing store went 700×720 → 0×0 → 700×720, and
  the projection stayed centred (`screenToGrid` at the canvas centre returns square 10,10 on a
  22×22 board). Before the fix, the same test left it at 0×0 permanently, because the first
  version of `syncSize` compared against a cached CSS box and never noticed.
- `test/smoke.mjs` was written against the engine before several fixes and caught three real
  engine bugs I had not spotted by reading: the out-of-bounds PC clamping into a wall, the
  treasure trigger, and creature placement order.
- `parseDamage` rejects `"1d6+"`, `"d6"`, `""` and `undefined`; the content loader refuses
  nineteen separate malformed packs (ragged map rows, a map character with no legend entry, a
  pillar pointing at missing lore, a creature missing a save, a command with an unknown kind, an
  area with no PC spawn, and so on). Each was confirmed to load *silently* before its check
  existed.

**Save round trip, in a real browser**

- Walked to the western pillar with arrow keys and Enter only, read it, autosaved.
  `localStorage["absalom-inheritance-save-v1"]` = 1,766 bytes, `__v: 1`, 484-character explored
  bitfield with 168 ones, all three creatures with HP and dormant flags.
- Reloaded the tab. Position (3,13), lore `["bequest"]`, 168 explored tiles restored, the read
  pillar's capstone dimmed, 3 log lines replayed, "Save loaded." in the panel.
- Clicked **Export save** with `URL.createObjectURL` hooked to capture the exact bytes a download
  would have written: 2,695 bytes, envelope `{format:"gvb-save", game:"absalom-inheritance",
  version:1, savedAt:…}`. Message read `Saved to absalom-inheritance-save-2026-07-28.json`.
- **Cleared localStorage entirely**, then imported the captured file through the real
  `importFromFile` path. Lore and PC state came back byte-identical to the export.
- **Corrupt files, all five refused** with "That is not a valid absalom-inheritance save." and the
  game still playable afterwards: garbage text, `{}`, a file truncated to half its length, a save
  stamped `game: "fourth-quarter"`, and a well-formed envelope wrapping a PC with no HP. Plus, in
  the Node suite, `{{{ not json` sitting in localStorage loads as `null` rather than throwing on
  boot.

**Played it, in the browser, to both endings**

- Keyboard-only, no pointer: walked up the west side (arrows + Enter), read the western pillar,
  modal opened with focus moved into it and closed on Escape, live region read "A carved pillar."
  Walking that route woke **nothing** — the cover route is real.
- Keyboard-only combat: walked into the middle, **exactly one** sentinel woke, killed it with
  number keys and Enter targeting over 4 rounds, ending at 13/15 HP. 25 log entries, 14 of them
  dice rolls with full breakdowns.
- Full run with real canvas clicks and real button clicks: west pillar → encounter → east pillar
  → encounter → gate opened → Keeper → **victory**. All three creatures slain, both pillars read,
  10 rounds of combat, finished at 15/15 HP because the gate's rest had restored it. Victory modal
  open with the right title and body.
- Defeat also verified, earlier, against the original build: 0 HP, dying modal, correct text.

**Mobile, at 375×812**

`grid-template-columns` resolves to a single `375px`. `body.scrollWidth` 375 — no horizontal
overflow. Board canvas 375×773 with a correct 750×1546 backing store at dpr 2. Tile size 15.95px,
whole board fits both axes, and all four map corners plus the spawn and the casket resolve to
on-screen pixels. Tab bar switches Sheet / Board / Log correctly, all three save-bar buttons
reachable on the Sheet tab, and the canvas re-measures and takes focus when the Board tab is
revealed. For comparison, the same measurement on the original: `260px 0px 320px`.

**Zero offsite requests.** Full network trace on a fresh load is 10 same-origin requests: the
HTML, eight modules, `assets/js/gvb-save.js`, and `content/vault.json`. No fonts, no CDN. This
game was one of the few pages in the repo where the claim was genuinely true and it still is.

---

## Shared-file requests

**1. A preview and an OG card, please (prompt 21).** Locked decision #28 says a preview is a
frame from play and the capture has to prove it got there. This one is easy to prove and it is a
good screenshot — an isometric vault with a lit sentinel and gold capstones.

Recipe for `Tools/board-check/games.mjs`:

```js
'absalom-inheritance': {
  url: '/Projects/absalom_inheritance.html',
  frame: { width: 1280, height: 800 },
  saveKey: 'absalom-inheritance-save-v1',
  three: null,                       // no three.js; plain canvas
  async open(page) {
    // No title screen and no intro overlay — the board is up as soon as
    // window.__absalom exists. That is the only thing to wait for.
    await page.waitForFunction(() => !!window.__absalom);
  },
}
```

For the capture itself: the frame worth shooting is mid-encounter, not the spawn. The spawn is a
lone figure in an unlit room; the good frame has a woken sentinel, gold pillar capstones in view,
and the HP bars up. Getting there needs three tile clicks north from the spawn, which the page
makes drivable without guessing at pixels:

```js
// window.__absalom = { game, renderer, slot, content }
// renderer.screenToGrid(px, py) inverts the live projection, so a driver can
// scan for the pixel that maps to a square instead of hardcoding tile maths.
// Walking to roughly 10,13 wakes exactly one sentinel and the encounter starts.
```

Assert `window.__absalom.game.mode === 'combat'` and
`window.__absalom.game.awake().length === 1` before shooting — that is the proof it reached play.

The card's `data-preview` and description are the board's to change; the description currently
reads "An isometric crawler built on PF2e Remaster rules." which is still accurate, so no notice
edit is needed. **Please do not add `data-new`** — the game is not new, it is repaired.

**2. Nothing needed for the board `href`.** The URL did not move. Noting it explicitly so nobody
goes looking.

**3. No `gvb-save.js` gaps.** Every hook this game needed already existed — `defaults` as a
factory, `repair`, and `buttons` on `mountSaveBar` were the three The Fourth Quarter added in
session 7, and they were exactly the three I reached for. The module did not need a fourth thing.
Worth recording as evidence the generalisation landed in the right place.

**4. `Pathfinder/data/` — a request for a decision, not a change.** 24 JSON files of real
Remaster rules data sit next door and this game hardcodes a subset in its own content pack. A
CRPG that read the real ancestries, classes, feats and spells would be a different and much
larger game. What I would want before anyone builds that:

- Agreement on whether `Pathfinder/data/` is a *published* interface or private to prompts 01–03.
  If a game may depend on it, its shape needs to be stable, and today nothing says it is.
- A read-only copy convention. Locked decision #17 says each project vendors its own copy and
  nothing is shared across projects, which points at vendoring a subset into
  `Projects/absalom-inheritance/content/` rather than reading `Pathfinder/data/` at runtime.
  That is probably the right answer and it is not mine to declare.

I deliberately built no runtime dependency on it this session, as the prompt asked.

---

## Deliberately not done

**A second area.** This is the honest gap and I want to be plain about it. The content format is
built, documented, and does real work, but `area` is one object rather than an array and there is
no transition trigger, no per-area fog slice, and no "which area am I in" that ever holds a second
value. I chose to spend the session on "the game can be finished, saved, played on a phone and
played without a mouse" over "the game is twice as long", because a longer unwinnable game is
worse than a short winnable one. §11 of the authoring guide lists the four files a second area
touches, in order.

**Restructuring to `Projects/absalom-inheritance/index.html`.** Covered above: keeping the URL
gets the whole benefit for none of the cost. The underscore in the filename survives, and I think
that is the right trade.

**A browser-driven suite of my own.** `Tools/board-check` is prompt 21's and I did not touch it.
I could have written a Puppeteer driver inside my own folder reaching into
`Tools/board-check/node_modules`, and chose not to: it would duplicate `games.mjs` and `drive.mjs`
against locked decision #38, and reach outside my boundary for a dependency. The Node suites plus
the browser verification above cover it, and `npm run games` is the right long-term home. The
recipe above is what it needs.

**Reactions, including Shield Block.** Shield is in as a +1 AC buff. Modelling reactions properly
means an interrupt point in the turn loop, which is a real feature and would want its own session.
Flagged in the pack's `note` rather than left to look implemented.

**A true PF2e cone template.** The ±45° approximation is documented in the pack and in the guide,
and the renderer previews the affected squares so nobody is guessing. Replacing it with a real
template is maybe 30 lines and would change balance slightly, so it wants a `balance.mjs` run
attached.

**The dying and recovery rules.** Still out of scope, still confessed in the defeat text. 0 HP
ends the run. With one PC and nobody to Administer First Aid, the full condition track would add
a lot of machinery to reach the same outcome.

**`tuning.standardDC`.** Loaded, defaulted, and read by nothing. Kept because the first skill
check added here will want it, and called out in the guide so it does not become one of the
phantom hooks Torchbearer's audit found six of.

---

## Next session

Ordered by value per effort.

**How much game is there? About 8–12 minutes for a first completion, 5 on a replay.** Concretely:
one 22×22 room, three creatures, two lore pillars, one gate, one casket, two acts either side of a
single rest. Roughly 20 tile-clicks of travel and 30-odd combat actions; median 10 rounds of
encounter across the run. There is **no character build** — the PC is one fixed Human Wizard 1,
there is no levelling, no equipping, and no choice at any point outside tactics. That last part is
the biggest gap between this and "a CRPG", and it is a bigger gap than the length.

1. **A second area, and the transition that makes it possible.** The cheapest thing that doubles
   play time, and the format is already 80% of the way there. Guide §11 has the four-file list.
   One more room of the same size and density is roughly one more act. Do this before anything
   systemic — content is what turns a demo into something you keep adding to, and the authoring
   surface is now good enough that a room is a JSON edit plus a `balance.mjs` run.

2. **Something to choose at character creation.** Even three prebuilt level-1 PCs — the wizard,
   plus a fighter and a cleric with their own `commands` arrays — would make the content format
   earn its keep and give the game a reason to be replayed. `pc` is one object in the pack today;
   making it an array with a pick screen is small, and `defaults` is already a factory precisely
   so a randomised or chosen starting state fits.

3. **Take the preview recipe above and shoot it** (prompt 21). Small, and this game is the best
   screenshot on the board that does not have one.

4. **Reactions.** Shield Block, Attack of Opportunity. This is what would make the tactical layer
   feel like PF2e rather than like PF2e's arithmetic. It needs an interrupt point in the turn loop
   and it needs `balance.mjs` re-run afterwards, because Attack of Opportunity in particular
   changes how safe it is to walk past a sentinel.

5. **A real cone template** and the `balance.mjs` run to go with it. Half an hour.

6. **Decide the `Pathfinder/data/` question** (Shared-file requests #4). Not urgent, but it blocks
   the largest possible version of this game, and the decision is cheaper to make now than after
   someone has built against it.

One process note worth carrying forward, because it changed what I built: **the balance harness
paid for itself three times over and none of them were balance.** It found a bug that was costing
a third of all runs, it told me that two of my four "obvious" tuning changes did roughly nothing,
and it turned "this fight feels hard" into "0 wins in 2000". Any game in this repo with a
combat system and a headless rules layer can have one in an afternoon, and The Fourth Quarter and
Torchbearer both already have the headless layer.
