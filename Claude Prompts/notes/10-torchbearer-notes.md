# Torchbearer — session notes

First session this game has ever had. No backlog existed, so this is an audit plus the
top of the plan it produced.

The short version: two finished adventure packs had been sitting in the repo unreachable,
the Fighter's Shield Block had never worked, and the authoring guide promised six engine
hooks that do nothing. All three are fixed or written down. The game also adopted
`gvb-save.js` and now has a test suite where it had none.

## What changed

**The folder is `Projects/torchbearer/` now.** `Projects/Torchbearer files/` is gone.

| Was | Is |
| --- | --- |
| `Projects/Torchbearer files/content-authoring-guide.md` | `Projects/torchbearer/content-authoring-guide.md` |
| `Projects/Torchbearer files/thornwake-vigil (1).json` | `Projects/torchbearer/packs/thornwake-vigil.json` |
| `Projects/Torchbearer files/sample-expansion-embers-of-the-hold.json` | `Projects/torchbearer/packs/embers-of-the-hold.json` |

Done with `git mv`, and `git status` shows all three as `R`, so the rename is in the index
and not just on disk (locked #14). Nothing in any HTML, JS or JSON referenced the old path,
so nothing broke. Prompts 11 and 13 both point a reader at
`Projects/Torchbearer files/content-authoring-guide.md` as a precedent; those references are
now stale and want updating when someone next touches those prompts.

**`Projects/torchbearer.html` keeps its URL.** I did not restructure it into
`Projects/torchbearer/index.html`. Reasoning is under "Deliberately not done". The board
needs no change from me.

**The two sample packs are reachable.** New section on the title screen called The Shelf.
It fetches `packs/index.json` after the page is already interactive, renders a card per
pack, and loads one in a single click. Before this, playing "The Long Vigil at Thornwake
Bridge" meant knowing it existed, finding it on GitHub, downloading raw JSON and feeding it
to a file picker. It is now three clicks from a cold page: load the pack, forge a hero,
begin.

New file `Projects/torchbearer/js/library.js` does the fetching. Paths resolve from
`import.meta.url`, not from the page, so moving the HTML later will not break it. The
manifest fetch is deliberately allowed to fail silently: opened over `file://` or offline,
The Shelf hides itself and Load Content JSON still works. `CORE_PACK` and `ADVENTURE_PACK`
stayed inline in the HTML for the same reason, so booting never waits on a request. Measured
after the change: 4 same-origin requests total (3 modules + the manifest), 0 offsite.

`packs/index.json` carries `id`, `name`, `type` and `description` per pack. Those four are
asserted against each pack's own `pack` block by the test suite, so the shelf cannot lie
about what it is offering. What a pack contains is counted from the pack itself on the load
confirmation rather than written down twice.

**Adopted `assets/js/gvb-save.js`.** New file `Projects/torchbearer/js/save.js` holds the
slot. Key stays `torchbearer-save` (locked #36). Version 2. Old saves carry `{"v": 1}` and no
`__v`, so `normalize()` reads them as version 0 and they come through `migrate` (which
deletes the dead `v` field) and then `repair` like anything else.

The game had hand-rolled all three doors already, which is why it was the right candidate:
`localStorage`, a Blob download, and an `<input type="file">` that `JSON.parse`d whatever it
was handed and passed it straight to `finalizeCharacter`. There was no validation at any
point. What it gets now is one implementation of refusing garbage, a memory-backed fallback
for browsers that block storage, and the same export envelope every other game on the site
writes.

`repair` catches a real bug, not a hypothetical one. `App.loadSave` used to do
`cb.resources = s.hero.resources` wholesale. A save whose resource block predates a field
loses that field permanently. `potions` is the one that bites: `gotoScene` does
`hero.resources.potions++` on any scene that hands out a healing potion, `undefined + 1` is
NaN, the Chronicle still prints "Gained: Lesser Healing Potion", and the action button is
gated behind `(cb.resources.potions || 0) > 0` so it never comes back. Silent, permanent, no
error anywhere. A missing `slots` is louder: the party panel does `cb.resources.slots[1]` and
throws on render. `repairHero` fills both. `repairBuild` fills the nine fields
`finalizeCharacter` dereferences with no guard.

`validate` requires a build that names an ancestry, a background and a class as non-empty
strings. Those three get indexed into the Registry and then dereferenced immediately;
everything else has a default.

**The save bar is on the topbar, which is on screen during play.** That is v7 §9's open item
answered by construction for this game rather than fixed after the fact. `mountSaveBar`
mounts only `["import"]`. Export stayed hand-rolled because a Torchbearer save has been named
after its hero since the game shipped (`sera-voss.torchsave.json`) and `mountSaveBar` has no
filename hook. It still writes through `slot.exportToFile`, so the bytes are the standard
gvb-save envelope. There is a shared-file request below to collapse this.

**Registry and Validator moved to `Projects/torchbearer/js/registry.js`**, unchanged in
behaviour, because the validator is the contract the authoring guide describes and a contract
nothing tests drifts. It gained 8 rules, every one of which was already a promise the guide
made:

- `start` names a scene that exists. It was a required *field* and never a checked
  *reference*, so a typo validated and then dead-ended on "Missing scene" the instant a
  player picked the adventure.
- Every scene has a `text` array. The engine calls `sc.text.map` with no guard, so a scene
  without one validated fine and threw the moment someone walked into it.
- Every scene has a `title`.
- `victory` and `defeat` name real scenes. Both were unchecked.
- Every encounter foe names a monster that exists, in the pack or already loaded. Guide §14
  told authors to self-check this "against the validator's rules"; it was not one of them.
- Every `companionsOffered` id names a real companion.
- A background's `feat` exists.

All four packs that ship (core, Bell of Barrowmoor, and both bundled files) pass the
tightened validator with zero errors, checked before the rules went in.

**Fixed: `{"grantFeat": "<id>"}` did nothing.** The authoring guide documents it as "fixed
feat by id". Three pieces of core content use it that way: the Fighter's level-1 Shield Block
feature, and both Warpriest Cleric doctrines. The only code that ever read `grantFeat`
handled the strings `"class-1"` and `"general"` as extra feat *slots* in the builder. A
string that was neither fell through both branches and vanished.

Consequence: **no Fighter has ever been able to Shield Block.** Combat gates the reaction on
`specials.includes("shield-block")`, and that special only arrived if the player separately
spent their one general feat on the thing their class sheet already promised them. Same for
both Warpriests. `activeEffects` now resolves the id and applies that feat's own effects, one
level deep so a granted feat cannot grant itself into a loop.

**`loadSave` fails usefully now.** A save is a *build*, not a sheet, so a hero forged with the
orc ancestry from Embers of the Hold is meaningless in a browser that has not loaded that
pack. `finalizeCharacter` used to throw on `cls.perception` and the player got "Save could not
be restored: Cannot read properties of undefined". It now names the missing ids and says
where to get them. A companion from an unloaded pack costs you that companion, not the whole
save. An adventure that is not loaded restores the hero to the title screen with an
explanation instead of silently.

One wrinkle found while testing: `mountSaveBar`'s import handler calls `slot.save(state)`
*before* `setState`, so a rejected import has already overwritten the stored journey by the
time this code runs. The missing-content path re-saves the live game to put it back. Both
halves of that are shared-file requests below.

**The inline `<script>` is now `<script type="module">.`** Four imports at the top. Safe
because the page has no inline `onclick` attributes and had exactly one `window.` reference
(`DOMContentLoaded`, which still fires after a deferred module runs). There is now a
`window.__torchbearer` dev probe, since a module script has no globals for a driver script to
reach.

**Mobile, 375x812.** The play screen put a fixed 250px party rail beside the thing you are
actually reading, and the builder put a fixed 200px step rail beside it. Below 700px both
rails are now horizontal strips above the content, the topbar wraps, and the card grid drops
to one column. The combat grid keeps its 46px cells and scrolls inside `#grid-scroll`;
shrinking the cells makes the tokens unreadable and the tap targets too small.

**Accessibility.** The biggest thing here: **the character builder could not be operated
without a mouse.** Ancestry, heritage, background, class, subclass, feats, spells, gear,
companions and adventures are all picked with a bare `<div class="opt-card">` carrying an
`onclick`, built by seven different template strings, none of them focusable. There is now
one `makeCardsFocusable()` pass that adds `role="button"`, `tabindex` and `aria-pressed`
after each render, and one delegated keydown handler that turns Enter and Space into the
click. Doing it in two places rather than seven means the eighth template cannot forget.
(The `.abil-chip` and `.pick-btn` controls were already real `<button>` elements and needed
nothing.) Also: `role="log"` on the Chronicle so a screen reader hears each new roll once
without the whole log being re-read, `role="dialog"` + `aria-modal` + a real `<h2>` title on
the modal, focus landing inside the dialog when it opens, Escape to close it, `role="status"`
on the toast, and `aria-hidden` on the big d20 overlay because it restates a number the
Chronicle already logged.

The modal title changed from a `div` to an `h2`, so it now picks up the page's small-caps
brass heading style. That is a visible change and it looks intentional, but it is a change.

**Test suite where there was none.** `Projects/torchbearer/test/smoke.mjs`, 86 checks, exits
non-zero on failure. No browser needed. It slices `CORE_PACK` and `ADVENTURE_PACK` out of the
HTML with a string-aware brace matcher and runs them through the real validator, checks the
manifest against the packs on disk, feeds the validator eleven packs each with exactly one
thing wrong, and drives the save slot through every door.

## What I verified

```
node Projects/torchbearer/test/smoke.mjs
  86 passed, 0 failed

cd Tools/board-check && npm run check
  251 units checked, 0 broken
  0 collisions, tightest vertical gap 7.1px

cd Tools/board-check && npm run social:check
  23 notices · 23 already current · 0 out of date · 0 failed
```

251 units is up from v7's 235; the extra 16 are the new module, pack and test files. The
rename did not break a single link, which is the thing that sweep exists to catch.

**Guard-rails, broken on purpose first (locked #34).** The first version of this suite was
worthless in exactly the way v6's line-of-sight checks were: I unhooked `repair` from
`createTorchSlot` entirely and **all 80 checks still passed**, because every repair assertion
called `repairSnapshot()` directly instead of going through the slot. Rewrote them to go
through `load()`, `deserialize()` and an exported envelope. Then:

| Bug reintroduced | Result |
| --- | --- |
| `repair: s => s` in the slot | 4 failed |
| the scene-`text` validator rule neutered | 1 failed |
| `loadPack`'s `if (errs.length) throw` deleted | 2 failed |
| a direct `localStorage.setItem` put back in the page | 1 failed |

All four restored, back to 86 passed.

**Real browser, Chromium at 1280x720**, served over HTTP from the repo root. Built a Dwarf
Fighter ("Sera Voss") through all nine builder steps by clicking, loaded Thornwake from The
Shelf, played it in.

- The Shelf loaded `thornwake-vigil.json` in one click. Card flipped to "loaded", the pack
  appeared in Loaded content, and the Vane Family Saber from that pack showed up in the
  builder's weapon list, which is the cross-pack path working.
- Skill check rolled and branched: `11+2 = 13 vs DC 16 Failure`, scene went to `marker-bad`,
  flag `read-markers` set.
- Combat started: 91 grid cells, 5 tokens, initiative rolled for all five.
- **Shield Block fired.** Chronicle: `Sera Voss Shield Blocks: 5 damage rings off steel.`
  The hero's picked feats were `experienced-tracker, dwarven-doughtiness, power-attack,
  exacting-strike, cat-fall, toughness`. No Shield Block among them, on purpose.
- Then I removed the `grantFeat` expansion, reloaded, and re-imported the same save file:
  `specials` came back as `[reactive-strike, bravery, reduce-frightened, power-attack,
  exacting-strike, toughness]` with `shield-block` absent. Restored the fix. Same hero, same
  file, the bug appears and disappears with those seven lines.

**Export / import round trip.** Exported mid-adventure from the topbar with the game running:
`sera-voss.torchsave.json`, 2336 bytes, `{"format":"gvb-save","game":"torchbearer",
"version":2}`. Cleared `localStorage`, reloaded, imported the file back through
`promptImport`'s real picker path. Got back the same hero, the same companion (Mercy Vane
42/42), scene `bridge-fog`, flag `read-markers`, 2 potions, and all 4 Chronicle entries
re-rendered. Imported it once *before* loading Thornwake as well, and got the "Adventure Not
Loaded" modal naming the pack instead of a dead end.

**Corrupt files.** Six of them, fed through the same picker, with a game in progress:

| File | Result |
| --- | --- |
| the export truncated to 900 bytes | "That is not a valid torchbearer save." |
| `this is not json at all {% raw %}{{{{% endraw %}` | same |
| a Closing Time save envelope | same |
| `{"state":{"build":null}}` | same |
| `[]` | same |
| a build naming `nonexistent-class` | "Content Missing" modal naming the id |

In every case the running game was untouched: hero, scene, adventure and both party members
still there. After the `nonexistent-class` case I read `localStorage` back and confirmed it
held the live game (`fighter` / `bridge-fog` / `thornwake`), not the rejected import. Before
this session the first file would have taken the game down.

**Resume from localStorage** works: reloaded cold, clicked Resume Journey, landed in
Barrowmoor at the `arrival` scene.

**Mobile at 375x812**, measured with the new media query on and then disabled:

| | Before | After |
| --- | --- | --- |
| horizontal overflow | 202px | 0 |
| party rail | 250x704 vertical | 375x124 horizontal strip |
| scene text column | 156px | 351px |

Choice buttons come out 351px wide and 58 to 74px tall, so the tap targets are fine.

**Keyboard.** Focused an ancestry card and pressed a real Enter: it selected, `aria-pressed`
flipped to `true`, and Next enabled. 23 of 32 feat cards focusable, the other 9 being the
disabled ones at `tabindex="-1"`. Escape closes a modal.

**Zero offsite requests**, confirmed from `performance.getEntriesByType('resource')`: four
entries, all `127.0.0.1`.

## Shared-file requests

**1. `mountSaveBar` needs a `filename` option.** Torchbearer names exports after the hero and
has since it shipped, so it cannot use the module's export button. `exportToFile(state, name)`
already takes a name; `mountSaveBar` just never passes one, and `slot.filename` cannot be
overridden from outside because `exportToFile` closes over the local function rather than
reading the property. Suggested change in `assets/js/gvb-save.js`:

```js
export function mountSaveBar(container, slot, handlers = {}) {
  const { getState, setState, onMessage, confirmReset = true,
          buttons = ["export", "import", "reset"],
          filename = null,            // () => string, optional
        } = handlers;
  ...
  export: () => button("export", "Export save", "Download this save as a file", () => {
    const name = slot.exportToFile(getState(), filename ? filename() : undefined);
    say("Saved to " + name);
  }),
```

`exportToFile`'s `name = filename()` default already handles `undefined` correctly, so this
is additive and no existing caller changes. When it lands, Torchbearer can drop its
hand-rolled Export button and mount `["export", "import"]`.

**2. `mountSaveBar`'s import handler saves before it asks.** It currently does:

```js
slot.save(state);
if (setState) setState(state);
say("Save loaded.");
```

A host that rejects the imported state in `setState` has already had its stored save
overwritten. Torchbearer hits this whenever someone imports a hero built from a pack this
browser has not loaded. Two independent fixes, either is fine:

- Call `setState` first and `slot.save` second.
- Let `setState` veto by returning `false`, and skip the save when it does.

Also worth knowing: `say("Save loaded.")` runs after `setState`, so any toast the host raises
during `setState` is overwritten within the same tick. Torchbearer moved its two
import-failure messages to modals because of this. A `say` that does not fire when `setState`
already spoke, or a message the host can suppress, would be tidier.

**3. Preview and OG image.** This game has neither, unlike the seven that do. It deserves
one now that the sample content is reachable. Recipe for `Tools/board-check/games.mjs`:

```js
'torchbearer': {
  title: 'Torchbearer',
  url: '/Projects/torchbearer.html',
  vw: 1320, vh: 800, dsf: 1,
  saveKey: 'torchbearer-save',
  intro: [],
  async open(p) {
    await p.waitForSelector('#screen-title.active');
    await p.waitForSelector('#library:not([hidden]) [data-shelf]');   // manifest fetched
    await p.click('[data-shelf="thornwake-vigil"]');
    await p.click('#modal-foot button');                              // "Splendid"
    // The builder is nine steps and there is no shortcut through it. For a
    // preview frame, import a prebuilt hero instead: the file is the one this
    // session exported, and page.__engine tells you which filechooser API to use.
  },
},
```

The builder is the problem for any driver script. I would rather not add a URL parameter or a
dev hook just for the harness. The cheapest answer is to commit one prebuilt
`.torchsave.json` under `Projects/torchbearer/test/` and have the recipe import it, which
also gives `npm run games` a save-round-trip beat for free. I did not commit that file this
session because the recipe is prompt 21's call. Say the word and I will add it.

For the frame itself, locked #28 says a preview is a frame from play and the capture has to
prove it got there. The shot I would take is the Thornwake bridge scene mid-combat: the
party rail on the left, the 13x7 grid with five tokens on it, and the Chronicle on the right
showing a rolled d20 seal. That is the one screen that shows this is a tactical engine and
not a text adventure. Assert on `#grid .cell` count and a non-empty `#chronicle` before
shooting.

**4. `Pathfinder/data/`.** 24 JSON files of PF2e rules data next door: ancestries, classes,
feats, spells, heritages, deities, hazards, treasure. Torchbearer's whole content format is
the same shape. The interesting version of this game reads them. I did not look further than
confirming the folder exists, because it is prompts 01 to 03's and creating a runtime
dependency on it was explicitly out of scope. Before anyone acts on this: it needs an owner
decision about whether that data is a shared asset or Pathfinder-only, and a schema
comparison, not a session of code. Worth a conversation, not a ticket.

**5. `npm run games`.** No entry for Torchbearer, and it should have one once item 3 lands,
since the recipe is the same object. The beats worth driving are the ones I did by hand:
shelf load, export, reload, import, corrupt file rejected with the game still up.

## Deliberately not done

**Did not split the page into `Projects/torchbearer/index.html`.** 2,972 lines in one file is
a lot, and for a platform with a content format the argument for splitting engine from
content loader from UI is real. I did not do it because it breaks
`/Projects/torchbearer.html`, and a broken URL costs more than the tidiness is worth: it is
the address on the board, in the OG tags, and in whatever links exist to it. What I did
instead gets most of the benefit at none of the cost. The three pieces that actually needed
to be testable under Node moved into `torchbearer/js/` as modules and the page imports them
by relative path, so the URL is unchanged and there is nothing to request from the board.
The remaining 2,600 lines are the builder, the combat engine and the two inline packs, and
none of those needs to leave to be tested. If someone does split it later, the modules are
already out and the import paths already work from either location.

**Did not move `CORE_PACK` and `ADVENTURE_PACK` into `packs/`.** Tempting, because it would
make the "authoritative worked example" a real file instead of a comment saying to read the
HTML. Rejected because the page would then boot on a network round trip that can fail, and
it would stop working over `file://` entirely. The Shelf can afford to fail; the title screen
cannot.

**Did not implement the six inert engine hooks.** `assurance`, `surprise-attack`,
`racket-scoundrel`, `edge-outwit`, `mobility`, `crossbow-ace`. Each is a real combat feature
and between them they are most of a session. I documented them honestly instead, which is the
part that was actually urgent: the guide listed all six as working, so an author had no way
to know a feat carrying one was decoration.

**Did not fix the potion `heal` field.** The Drink Potion action rolls a flat `1d8` and
ignores the item's `heal`. Core ships a Lesser Healing Potion advertising `2d8+5` that heals
`1d8`, and Barrowmoor hands out two of them. It is a two-line fix in the engine but it is a
balance change to a shipped adventure, not a bug fix, so it wants a deliberate decision.
Written into the guide as a known limitation.

**Did not grey out Shield Block in the general feat list.** Now that the Fighter's class
feature works, a Fighter who also spends their one general feat on Shield Block wastes it.
Same for both Warpriests. The builder still offers it. Small fix, but it is new behaviour
created by this session's fix and I would rather it be seen once before it is smoothed over.

**Did not write a browser-driven suite of my own.** Playwright and Puppeteer live in
`Tools/board-check/node_modules`, which is prompt 21's folder, and reaching into it from
`Projects/torchbearer/test/` would be a runtime dependency across a boundary that exists to
stop exactly that. The Node suite covers the pure logic; the browser work is written up above
and belongs in `npm run games` (shared-file request 5).

## Next session

Roughly in order of value per effort.

1. **Preview and OG image** (shared-file request 3). The game looks unfinished on the board
   next to seven cards that have one, and the reason it never got one is that the builder is
   nine steps deep. Committing one prebuilt `.torchsave.json` solves that for both the
   preview capture and `npm run games` in the same move.
2. **`npm run games` entry** (request 5). The five beats are already written down and were
   all driven by hand this session, so this is transcription.
3. **Implement `assurance`.** Cheapest of the six inert hooks by a distance: it is a floor on
   a skill roll, the check already funnels through `App.rollCheck`, and three pieces of core
   content carry it (two Assurance feats and the Farmhand background). Do this one first and
   the pattern for the other five is established.
4. **Decide the potion question.** Either make Drink Potion read the item's `heal`, or write
   down that one pool of `1d8` potions is intended and change the two core items to say
   `1d8`. Either is fine. The current state, where the item text and the engine disagree, is
   not.
5. **`racket-scoundrel`, `surprise-attack`, `mobility`, `edge-outwit`, `crossbow-ace`.** Real
   combat work, budget most of a session. `racket-scoundrel` is the most visible: it is one of
   three Rogue rackets and the only one that does nothing.
6. **Split the file, maybe.** If it happens, it needs the board `href` changed and the old
   URL will 404. Worth it only alongside something else that justifies touching the board.
7. **Grey out Shield Block for classes that already grant it.** One condition in the feat
   list builder.
8. **PF2e rules data** (request 4). The largest idea available here and the one most likely
   to be a different tool rather than a better one. Needs a conversation with whoever owns
   `Pathfinder/` before any code.
