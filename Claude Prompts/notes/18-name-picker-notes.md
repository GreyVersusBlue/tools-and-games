# Name Picker — session notes

## Student data

**No real student names were in the file.** The only names present were three
placeholders in the roster textarea's `placeholder` attribute — Aiden Smith,
Brooklyn Jones, Charlie Patel — which are generic and obviously invented. I checked
the whole git history too, not just the working copy: `git show ef8f69c` (the
original commit that added the tool) has the same three and nothing else. Every
name I added for tests and fixtures is fabricated.

**What it stores and where.** Thirteen `localStorage` keys under the `np_` prefix,
in the browser on whatever machine the page is open on. Nowhere else. The tool made
no network requests before this session except three Google Fonts hotlinks, and
those are gone, so it now makes **zero** requests after the page loads. No account,
no server, no analytics. Six of the thirteen keys hold student names:

| Key | Holds |
| --- | --- |
| `np_rosters` | every saved roster, by period |
| `np_current` | the roster on screen |
| `np_lucky` | one student's name plus a date |
| `np_stats` | lifetime pick counts, keyed by name |
| `np_history` | every pick, name and time |
| `np_hof` | Hall of Fame entries, by name |

`np_lucky` is the one that is easy to miss. The key name says nothing about student
data and it sits among preference-looking keys, but it stores a child's name.

**Can a user clear all of it in one action? Yes, now.** There is a new **🔒 Data**
tab with a single **Erase All Student Data** button. It clears those six keys and
keeps the other seven — themes, task prompts, options, and the unlocked retro
theme. That split was the interesting part of the work: "clear site data" in Chrome
takes the earned easter egg with it, and a teacher who wants the class list gone
does not want to re-unlock anything. A second, quieter button erases everything
including settings.

The confirm dialog states real counts before it does anything, e.g. *"This removes
28 student names, 1 roster, 28 sets of pick counts, 28 history entries and 0 Hall
of Fame entries."* Verified in a browser: after the erase, `Object.keys(localStorage)`
is `['np_options','np_theme']` and a regex for the seeded names across the whole of
storage returns `null`.

**Does the UI tell the truth about it? Yes.** The Data tab opens with a plain
paragraph saying everything stays in this browser on this computer, that there is
no account, server or analytics, and that the page makes no network requests. It
then says the catch out loud: a cleared browser or a reimaged machine takes the
rosters with it. Under that is a live census — rosters, names, students with pick
counts, history entries, Hall of Fame entries — and a table of all thirteen keys
saying which erase button gets each one. If the browser is blocking storage the
census area turns red and says nothing will survive closing the tab.

**On export.** It is a file of children's names leaving a managed machine, so:
the filename is `name-picker-roster-backup-YYYY-MM-DD.json` rather than the
module's default `name-picker-save-…`; the confirm dialog says how many names are
in it before writing anything (*"It will contain 28 student names across 1 roster,
plus pick counts and history, in plain text"*); and the text above the button says
to treat it like a printed class list and keep it on a school-managed drive rather
than a personal cloud folder or a shared machine's Downloads. Export and import
moved off the Names tab so they sit directly under that sentence instead of under
"Saved Rosters", where the honest framing was nowhere near the button.

---

## What changed

### Task one — the unguarded roster reads

Four bare `JSON.parse(localStorage.getItem('np_rosters')||'{}')` calls, at the old
lines 1009, 1016, 1026 and 1032 (`saveRoster`, `updateRosterUI`,
`loadRosterByName`, `deleteRoster`), plus two more in `exportAllData`. All six gone.
Reads go through the store, which refuses a bad blob rather than throwing.

Two distinct failures were in there, not one:

- **Corrupt JSON killed the page on load.** `updateRosterUI()` runs from the `load`
  handler, so a truncated `np_rosters` threw before the handler finished.
- **A roster whose value was not an array killed it on use.**
  `loadRosterByName` does `rosters[name].join('\n')`; if the value was a number
  that throws on click. The store's repair drops that one entry and keeps every
  healthy roster beside it, which is the real difference — the old code lost the
  whole set to one bad entry.

### Task two — adopted `assets/js/gvb-save.js`

Every one of the forty-six direct `localStorage` call sites is gone. `grep -n
localStorage 'Tools/Name Picker.html'` returns three hits and all three are inside
comments. New module: `Tools/name-picker/np-store.js`, imported by relative path so
the Node suite resolves it.

**All twelve key names are unchanged (locked decision #36), and so is every byte on
disk.** That second part took the design work. `gvb-save`'s `save()` does
`JSON.stringify({...state, __v: version})`. Spreading `__v` into an object-valued
key is harmless, but four of these keys hold arrays — `{...['a','b'], __v:1}` is an
object with numeric keys — and five hold bare strings that are not JSON at all
(`np_theme` is literally `medieval`, `np_crazy` is `1`). Either would have silently
discarded a teacher's stored value on first load.

So `boxed()` sits between the slot and storage: `gvb-save` sees `{value: <disk>}`,
`localStorage` sees exactly what the old build wrote. **Adopting the module rewrote
no stored data.** Asserted both ways — the suite checks `np_theme` is still a bare
string and `np_history` still starts with `[`, and in a real browser after a full
28-pick session no key anywhere in storage contains `__v`.

The module also made me keep three representations straight, which was the first
bug I wrote and fixed: **disk** (`'1'`), **app** (`true`), **box**
(`{value:'1'}`). `ok`/`fix` judge the disk form; `decode`/`encode` cross between
disk and app. My first draft had `snapshot()` returning app values and handing them
to validators expecting disk values, which silently dropped four keys from every
export.

**Grouping — the design question the prompt flagged.** Three groups, in a table in
code rather than a comment:

```
roster    np_rosters  np_current  np_lucky              student names
records   np_stats    np_history  np_hof                names + what they did
prefs     np_theme  np_prompts  np_options  np_crazy    no student data
          np_lucky_enabled  np_retro_active  np_retro_unlocked
```

`roster` and `records` are what the erase button clears. `prefs` survives. Putting
`np_lucky` in `roster` is the whole reason the grouping is worth having: it looks
like a preference and it is a student's name.

**`repair`, not `migrate`, for the per-key slots** (locked decision #37). All twelve
keys hold unversioned data on real machines, which reads as version 0, so `migrate`
would fire on every single load. My version of the bug v7 §2 describes — a field
added since shipping, absent from existing data, used somewhere that turns
`undefined` into a failure — is the **Hall of Fame ticker**: `updateHofTicker()`
calls `e.tier.toLowerCase()` on every entry, so one entry without a `tier` threw and
killed the ticker permanently. An entry can arrive without one from a hand-edited
key, a write truncated by a quota error, or a merge from an older backup. `repair`
drops entries with no usable name or tier and fills `tierClass`, `emoji` and `date`
on the rest. `np_options` is the same shape of problem by construction: every
option added later arrives as a fill-in.

`migrate` runs in exactly one place — the export bundle — where it lifts the
hand-rolled `{version: 2, rosters, currentRoster, hallOfFame, …}` backup format onto
the `np_` keys, so a backup a teacher saved months ago still restores. Those files
carry `version: 2` but no `format`, so `gvb-save` reads them as version 0 and hands
the whole object to `migrate`. That is version-specific reshaping, which is what
`migrate` is for.

**`defaults` is a factory on all thirteen slots** (`() => ({value: d.blank()})`),
not because any default is non-literal but because `blank()` for `np_options`
returns a spread of a shared object and a literal would have handed out the same
mutable reference.

**`mountSaveBar` is deliberately not used.** Reasons in *Deliberately not done*.

Export/import go through one extra slot, `key: 'np_bundle'`, given a
**memory-backed storage stub** so it can serialize, download and open a file picker
without ever becoming a fourteenth stored key. Asserted: `np_bundle` never appears
in storage.

### Task three — vendored the three fonts

Two `<link rel="preconnect">` tags and the `css2?family=Bungee&family=Outfit&…`
stylesheet deleted. Nine local `@font-face` rules with `unicode-range`.

**96.9 KB on disk across nine `.woff2` files** (99,192 bytes exactly). What a real
page load actually fetches is smaller, and that is the point:

- **41.5 KB on a normal first paint** — Bungee 400, Outfit 400, Outfit 600. Measured
  from the network log, not estimated.
- 55.3 KB once the settings panel pulls Outfit 700.
- The three Outfit and one Bungee `latin-ext` files (30.1 KB) are fetched only when
  a name on screen has a glyph in that range. An all-ASCII roster never touches
  them. They are vendored because this tool renders student names, and a name is
  the one string on a page you do not get to approximate.
- **Press Start 2P (12.5 KB) is never fetched unless the Konami code is entered.**
  No JS lazy-loading needed — `@font-face` is lazy by definition and nothing applies
  that family until `body.retro-mode` exists. Verified in the network log: three
  page loads requested it zero times, and it appeared immediately after the Konami
  sequence.

Weights: the old hotlink asked for Outfit 400, 600 and **800**, but the page uses
400, 600 and **700** (`.soundboard-btn` and one `<strong>`). Nothing used 800 — CSS
font matching was substituting 800 for the 700 request. I vendored 400/600/700, so
`font-weight:700` now renders as an actual 700. Soundboard buttons are very slightly
lighter than they were; that was an accident before, not a decision.

`Tools/name-picker/fonts/README.md` names sources, versions, designers and the
OFL-1.1 licence, with the three upstream `LICENSE` files copied in beside it.
Also records *why* the hotlink went unnoticed: `prepPage()` fulfils Google Fonts
requests locally from bundled `@fontsource` packages before the blocked-list check
runs, so `page.__blocked` was empty, and the browser suites only drive the seven
games. None of these three families were among the twelve `@fontsource` packages
already in `board-check/node_modules`, so I sourced them with `npm pack`.

`grep -c fonts.googleapis.com 'Tools/Name Picker.html'` → **0**. Same for
`fonts.gstatic.com`. My own comment about the change names "Google's font CDN"
rather than the domain, so that grep stays a meaningful check for the next session.

### Task four — fairness, which was the real bug

**Randomness was not fair, and this is a name picker's entire job.** Two separate
problems.

**1. Every pick was an independent uniform draw.** Over 28 students that repeats the
previous student about once every 28 picks and, after a full 28 picks, leaves
roughly ten of them never called — `1 - (1-1/28)^28 ≈ 0.64` coverage. `np_stats` and
`np_history` existed and were being written on every pick; **nothing ever read them
back**. New `Tools/name-picker/np-pick.js`: `fairPick` draws without replacement
inside a round, refills from the current eligible pool, and excludes the previous
pick from the first draw of a new round so a round boundary cannot produce a
back-to-back repeat.

New **⚖️ Fair rotation** option, **on by default**. Off gives the old independent
draws, and the label says plainly that they will repeat students and skip others.

Making that real needed a structural change: **every mode now chooses the winner
first and animates towards it.** Three of the five let the animation decide — jump
mode took whoever the last random highlight landed on, disappear mode the last card
standing, tournament mode the last spotlight. There was nothing to be fair about in
those modes because nothing chose a winner. Jump and tournament now land their final
highlight on the chosen name and stay off it on the penultimate hop so the last move
is visible; disappear mode eliminates everyone else in a shuffled order.

Multi-pick draws through the same rotation, so picking 4 partners spends 4 turns
rather than sidestepping the round. Seven picks of four cover a class of 28 exactly
once.

**2. `makeGroups()` was not shuffling.** It used
`originalNames.slice().sort(() => Math.random() - 0.5)`. The comparator is
inconsistent, so the result depends on the sort implementation and strongly favours
leaving elements near where they started. Measured over 20,000 shuffles of six
names: the first slot deviated by up to **2,438 from an expected 3,333** — the first
name on the roster landed in group 1 far more often than one in n. Fisher-Yates
deviates by 68. Also switched group dealing so sizes differ by at most one.

The rotation lives **in memory, per page load**, not in storage. A class period is
one page session and it was not worth a fourteenth key. Loading a different roster
or pressing Reset Board starts a clean round; marking a student absent mid-period
does not reset anybody's turn.

### Also fixed: none of the options persisted

Only the theme, Crazy mode, the retro unlock and the lucky-student switch survived a
reload. Sound, confetti, dramatic pause, cold-call, rarity, sudden death, the Hall of
Fame ticker, multi-pick count, group count, mode and speed all reset every time the
page opened — noticeable on the second period of the day. `np_lucky_enabled` existing
at all is evidence somebody had already hit this once and solved it for one switch.

All of them now live in **one new key, `np_options`**, rather than eleven. It is the
only key I added, and anything added later arrives through `repair` as a fill-in.

### Accessibility, projector and mobile

- **`@media (prefers-reduced-motion: reduce)`** — nine rules. A picker animates by
  definition, so this keeps the pick legible and drops what moves the whole screen:
  shakes, the background pulse, the chaos particle stream, confetti, fireworks,
  lightning, the scrolling ticker. The highlight and winner still scale up, they
  just stop lurching.
- **`:focus-visible`** outlines on every control. There were none.
- **Mobile at 375×812.** No horizontal overflow, all 28 name cards inside the
  viewport, the panel goes full-width, the tab row wraps to two lines, PICK A NAME
  is full-width and 55px tall. Header and footer controls measured 31–35px tall,
  which is a miss for a thumb reaching up mid-lesson; they are 40px minimum now.

### Files

| Path | What |
| --- | --- |
| `Tools/Name Picker.html` | rewired: module script, no direct storage, fair picking, Data tab, vendored fonts, reduced motion, mobile |
| `Tools/name-picker/np-store.js` | new — thirteen keys on `gvb-save`, grouped |
| `Tools/name-picker/np-pick.js` | new — fair rotation, Fisher-Yates, groups |
| `Tools/name-picker/test/smoke.mjs` | new — 207 assertions, plain Node |
| `Tools/name-picker/test/blocked-storage.html` | new — the case Node cannot reach |
| `Tools/name-picker/fonts/` | new — nine woff2 (96.9 KB), README, three licences |
| `Tools/name-picker/README.md` | new |

The page **stayed at `Tools/Name Picker.html`**, space and all, so
`Tools/Name%20Picker.html` and the board's `href` both still resolve. **No
shared-file `href` request is needed.** Reasoning in *Deliberately not done*.

### Every storage key, and what happened to it

| Key | Group | Before | Now |
| --- | --- | --- | --- |
| `np_rosters` | roster | 9 sites, 4 of them unguarded `JSON.parse` | store slot; bad blob refused, bad entry dropped, rest kept |
| `np_current` | roster | 3 sites, array | store slot; array on disk unchanged |
| `np_lucky` | roster | 3 sites | store slot; **reclassified as student data** |
| `np_stats` | records | 5 sites, `try/catch` | store slot; non-numeric counts coerced to 0, no more `NaN%` bar widths |
| `np_history` | records | 5 sites, `try/catch` | store slot; unusable rows dropped, `time` never `undefined` |
| `np_hof` | records | 5 sites, `try/catch` | store slot; **entry with no `tier` no longer kills the ticker** |
| `np_prompts` | prefs | 5 sites, `try/catch` | store slot |
| `np_theme` | prefs | 3 sites, bare string | store slot; **still a bare string on disk** |
| `np_crazy` | prefs | 2 sites, `'1'`/`'0'` | store slot; still `'1'`/`'0'` on disk |
| `np_lucky_enabled` | prefs | 3 sites | store slot; unchanged on disk |
| `np_retro_active` | prefs | 2 sites | store slot; unchanged on disk |
| `np_retro_unlocked` | prefs | 2 sites | store slot; **survives a student-data erase** |
| `np_options` | prefs | did not exist | **new.** Eleven options that never persisted, in one key |

Vendored font total: **96.9 KB** on disk, **41.5 KB** on a typical first paint.

---

## What I verified

### `node Tools/name-picker/test/smoke.mjs` → 207 passed, 0 failed

```
name-picker smoke

  fair rotation over 280 picks:  min 10, max 10, spread 0
  uniform draws over 280 picks:  min 6, max 16, spread 10
  first-pick uniformity over 28000 rounds: expected 1000, worst deviation 67
  shuffle bias, position 1 of 6 over 20000 shuffles: comparator worst 2437.7, Fisher-Yates worst 67.7 (expected 3333.3)

name-picker: 207 passed, 0 failed
```

Seeded LCG rather than `Math.random()`, so a distribution assertion cannot pass or
fail on luck (locked decision #40).

### The corrupt-data case, before and after (locked decision #34)

I put the bug back rather than trusting the fix. `git show HEAD:"Tools/Name
Picker.html"` into a temp copy, served it, seeded `np_current` with three valid
names and `np_rosters` with a truncated `{"Period 3":["Aiden Alvarez"`, reloaded.

**Before** — evaluated in the page:

```
JSON.parse(localStorage.getItem('np_rosters')||'{}')
  → SyntaxError: Expected ',' or ']' after array element in JSON at position …
#rosterList.innerHTML   →  ""      (updateRosterUI died mid-function)
#countDisplay.textContent → ""     (the statement AFTER it never ran)
#statsList.innerHTML    →  ""
names.length            →  3       (so it was not an empty-roster case)
```

The empty `#countDisplay` with `names.length === 3` is the clean proof: the load
handler aborted inside `updateRosterUI()` and everything after it was skipped. Temp
copy deleted.

**After** — same corrupt value still on disk, unmodified:

```
localStorage.getItem('np_rosters')  →  {"Period 3":["Aiden Alvarez"   (untouched)
#rosterList.innerHTML  →  <p class="muted-text">No saved rosters yet</p>
#countDisplay          →  "3 names in pool"
.name-card count       →  3
```

The bad value is **refused, not rewritten** — the store does not overwrite data it
cannot read, so nothing is destroyed on the way past. The suite also drives five
more shapes (`undefined`, empty string, `[]`, `42`, `"a string"`, `null`) and the
mixed case where one roster is a number and another is a valid list: the number is
dropped, the list survives.

### Storage blocked → `Tools/name-picker/test/blocked-storage.html`, 10 of 10 pass

Chrome's site settings cannot be driven from a script, so the fixture installs the
real failure — a throwing getter on the `localStorage` **property**, which is what
Chrome actually does, rather than a failing `setItem`. Installed before the module
imports.

```
PASS  the localStorage property really does throw when touched   1 access threw
PASS  createStore() survives it
PASS  the store reports memoryOnly
PASS  reading a key does not throw
PASS  a blocked read returns the default
PASS  writing a key does not throw
PASS  the write is readable back from memory
PASS  defaults come through for every key                        13 keys
PASS  snapshot, census and both erase paths all run
PASS  export still serializes, so a roster can be rescued to a file
All 10 checks passed — the tool runs with storage blocked.
```

The page does not white-screen and the Data tab turns red to say nothing will
survive the tab closing. The Node suite covers the same ground with an injected
throwing stub, which is how I found the `gvb-save` gap below.

### Export / import round trip

Verified twice: in Node, and end-to-end in a real browser.

**In the browser.** The export side needs no engine knowledge, per v7 §3 — hook
`URL.createObjectURL` to read the exact bytes a download would have written and
neuter the anchor click so no file is saved. Seeded 8 names through the real UI,
saved a roster, then clicked the real **Save a Backup File** button:

```
confirm text   "Save a backup file?  It will contain 8 student names across 1
                roster, plus pick counts and history, in plain text.
                File name: name-picker-roster-backup-2026-07-29.json
                Save it somewhere you would be comfortable keeping a printed
                class list."
a.download     name-picker-roster-backup-2026-07-29.json
blob type      application/json
bytes          1153
envelope       format gvb-save · game name-picker · version 3 · savedAt present
state keys     all 13
np_rosters     {"Period 5 Honors": [8 names, in order]}
"__v" in file  false
```

Then erased through the real **Erase All Student Data** button (`localStorage` down
to `['np_theme']`, no name anywhere), and fed those exact captured bytes back as a
real `File` through `store.bundle.importFromFile` — the same path `promptImport()`
uses, minus the OS dialog these tools cannot answer:

```
importFromFile error   null
keys written           13
roster back            {"Period 5 Honors": [all 8 names, same order]}
```

A foreign save file through the same call is refused:
`"That is not a valid name-picker save."`

Finally reloaded the page to prove the tool itself picks the restored data up rather
than just localStorage looking right:

```
names input      8 lines, first "Aiden Alvarez"
roster list      "Period 5 Honors (8)"
count display    "8 names in pool"
census           1 saved roster, 8 student names
console errors   none
```

**In Node**, asserted:

- envelope is `format: "gvb-save"`, `game: "name-picker"`, `version: 3`, stamped
- filename is `name-picker-roster-backup-2026-07-28.json`
- `clearAll()`, then import → all 13 keys back, 3 rosters, 24 names in Period 3,
  pick counts, theme, Hall of Fame tier, retro unlock
- rubbish refused: non-JSON, a bare array, and a file with `game: "fourth-quarter"`
  all return `null` rather than half-loading
- merge mode: rosters add, pick counts sum (5 + 3 = 8), a teacher's own prompts are
  not overwritten, settings are not reached into
- **a real `version: 2` backup file still imports** and lands on the `np_` keys

### Fair picking, end to end in a real browser

Not just the module — the actual page, real clicks. Loaded a class of 28, set
multi-pick to 7, ran four picks through the UI, then read `np_history` off disk:

```
picks: 28   distinct: 28   duplicates: []   backToBack: []
```

Every student in the class called exactly once before anyone twice, no student
called twice in a row, and `np_stats` came back with all 28 students on a count of 1.

### The on-disk format did not change

After that full session in a real browser:

```
keys           np_current  np_history  np_options  np_rosters  np_stats  np_theme
__v anywhere   []                       ← nothing leaked a version stamp
np_history     starts with "["          ← still an array, not an object
np_stats       starts with "{"
np_theme       "default"                ← still a bare string, not JSON
```

### Erase, in a real browser

```
confirm text: "Erase all student data from this browser?  This removes 28 student
names, 1 roster, 28 sets of pick counts, 28 history entries and 0 Hall of Fame
entries.  Your themes, task prompts, options and anything you have unlocked are
kept.  This cannot be undone. If you have not saved a backup file, cancel and do
that first."

after:  keys = ['np_options','np_theme']
        /Rosa Reyes|Aiden Alvarez|Zoe Zaman/ across all of storage  →  null
        census = 0 rosters, 0 names, 0 counts, 0 history, 0 hall of fame
        board = 0 cards, names input empty
```

The suite additionally asserts every one of the 28 fabricated names is absent from
a dump of storage after `clearStudentData()`, and that each non-`prefs` key is
`null` — removed, not emptied.

### Fonts

Network log for a real page load, three separate loads:

```
GET /Tools/name-picker/fonts/bungee-latin-400-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-400-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-600-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-700-normal.woff2   200   (panel opened)
```

Nothing else. **No request left localhost.** No `latin-ext` file was requested at
all (ASCII roster), and `press-start-2p-latin-400-normal.woff2` appeared **only**
after I dispatched the Konami sequence:

```
before konami:  document.fonts loaded = [Bungee 400, Outfit 400, Outfit 600]
                press-start-2p requested: never
after konami:   body.retro-mode = true, unlock banner shown,
                np_retro_unlocked = "1", np_retro_active = "1",
                .title font-family = "Press Start 2P", monospace
                GET press-start-2p-latin-400-normal.woff2  200
```

`grep -c fonts.googleapis.com` → 0. `grep -c fonts.gstatic.com` → 0.
`page.__blocked` is **not** what I used, per the prompt.

### Mobile, 375×812

```
horizontal overflow            0px
body scrollable sideways       false
name cards rendered            28
cards outside the viewport     0
PICK A NAME                    355×55, full width
smallest header/footer control 40px  (was 31px — fixed this session)
settings panel                 full viewport width
tab row                        wraps to two rows
```

### Reduced motion

The media block is present and matched 9 rules, targeting the right things
(`*/::before/::after`, `.shake-active*`, `body.crazy-active, body.sudden-death`, the
particle and confetti containers, the ticker, the highlight and winner states). I
could **not** force `prefers-reduced-motion: reduce` on — the browser tools here
have no emulation for it — so this is a static check that the rules exist and
select correctly, not a rendered before/after. Flagging it rather than claiming
more than I did.

### Repo-wide

```
node assets/js/gvb-save.test.mjs   →  39 passed, 0 failed   (file untouched)
npm run check                      →  298 units checked, 0 broken
                                      0 collisions, tightest vertical gap 7.1px
npm run social:check               →  23 notices · 23 already current · 0 out of date
```

Two notes on those numbers. **The unit count is 298, not the 235 the prompt
expects** — the baseline moved under me while I worked, because roughly twenty other
sessions are adding files to this repo right now. I watched it go 292 → 298 between
two of my own runs. My files account for **+5** of it: three `.mjs`/`.js` modules
plus the two inline scripts in `blocked-storage.html`. 0 broken is the number that
matters.

**`social:check` showed 2 DRIFT mid-session**, on `Tools/Schedule Browser as of
260715.html` and `Tools/Schedule Visualizer and Browser Generator v60.html` — prompt
19's files, not mine. Both were clean by my final run; another thread fixed them. My
page was in the "already current" set throughout. I did not touch anything inside
the `gvb:social` markers.

`npm run games`, `npm run play` and `npm run previews` were **not** run. They open
real visible browser windows, other threads may be using them, and none of them
drives the tools anyway.

---

## Shared-file requests

Two, both in `assets/js/gvb-save.js`. Neither is urgent; the Name Picker works
around both locally.

### 1. `load()` does not guard `store.getItem` — one line

`save()` wraps `setItem` in a `try`. `reset()` wraps `removeItem`. `load()` wraps
`JSON.parse` but calls `getItem` bare:

```js
  function load() {
    if (!store) return null;
    const raw = store.getItem(key);      // ← the one unguarded storage touch
    if (!raw) return null;
```

So a storage object whose `getItem` throws propagates straight out through
`load()`, past the "returns `null`, never throws" contract the README states. Its
own `defaultStorage()` hides this — a browser that blocks storage fails the
`setItem` probe and gets swapped for a memory stub before any read happens — but an
**injected** storage gets no such treatment, and injecting one is exactly what the
tests do. I hit it as a hard crash in my suite:

```
Error: The operation is insecure.
    at Object.getItem (test/smoke.mjs:262)
    at Object.load (assets/js/gvb-save.js:137)
```

Applicable blind:

```js
  function load() {
    if (!store) return null;
    let raw;
    try { raw = store.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
```

Worked around in `np-store.js`'s `boxed()`, which try/catches `getItem`,
`removeItem` and the `__memoryOnly` getter. Six projects read `gvb-save.js`, so I
did not edit it.

### 2. `mountSaveBar` cannot set the export filename

`mountSaveBar`'s export button calls `slot.exportToFile(getState())` with no name,
so it always gets `slot.filename()` — `<game>-save-YYYY-MM-DD.json`. There is no
way to override it from the mount call, even though `exportToFile(state, name)`
accepts one.

That is why this tool does not use the save bar. Its export file is a plain-text
list of children's names, and `name-picker-save-2026-07-28.json` does not say so
where it matters — in a Downloads folder, six months later, on a shared machine.
`name-picker-roster-backup-2026-07-28.json` does.

Applicable blind — add a `filename` handler alongside `getState`:

```js
  const {
    getState, setState, onMessage, confirmReset = true,
    buttons = ["export", "import", "reset"],
    filename = null,                    // () => string, or a string
  } = handlers;
```

and in the export button:

```js
    export: () => button("export", "Export save", "Download this save as a file", () => {
      const want = typeof filename === "function" ? filename() : filename;
      const name = slot.exportToFile(getState(), want || slot.filename());
      say("Saved to " + name);
    }),
```

Worked around by keeping the tool's own two buttons wired to
`store.bundle.exportToFile(snapshot, name)` and `store.bundle.promptImport()`. No
`reset` button is mounted anywhere, per the prompt's warning — this tool has two
erase controls of its own and a third would be the exact footgun `buttons` exists to
prevent.

### Not a request, but worth recording

`gvb-save`'s `save()` writes `JSON.stringify({...state, __v: version})`, which means
**a slot cannot hold an array or a scalar**. Every current adopter happens to store
an object, so nothing has hit it. This tool has nine keys that are arrays or bare
strings, and `boxed()` in `np-store.js` is the workaround: box as `{value: …}` for
the module, unbox on write so the disk format is untouched. If a second project
needs the same thing, that adapter is the piece to lift into the module — as a
`box: true` option, say — rather than writing it twice. I am not requesting it yet
on one data point.

---

## Deliberately not done

**The easter eggs, left alone once I knew what they do.** Four of the twelve keys
looked like cruft and none of it is:

- `np_retro_unlocked` / `np_retro_active` — the **Konami code** (`↑↑↓↓←→←→BA`,
  detected globally, even inside text inputs) unlocks a full retro arcade theme:
  scanlines, a vignette, magenta-on-cyan, Press Start 2P everywhere, and an
  ACHIEVEMENT UNLOCKED banner. Unlocked and active are separate keys so the toggle
  works without re-earning it. The Options tab has a deliberately vague hint:
  *"🕹️ Secret: try the classic cheat code..."* This is the same family as locked
  decision #7's Anathema Archive egg. Left exactly as it was, except that the
  unlock now **survives an erase of student data** — it is not student data, and
  making a teacher re-earn it to clear a class list would be daft.
- `np_crazy` — not an egg, just persistence for the LET'S GO CRAZY toggle.
- `np_lucky` / `np_lucky_enabled` — "Lucky Student of the Day". One student per day
  gets reweighted rarity rolls (`[25,25,22,15,8,5]` instead of
  `[50,25,14,7,3,1]`) and a ⭐ on their card. It only touches which *rarity banner*
  shows, never who gets picked, so it does not fight fair rotation. Reclassified as
  student data because it stores a name; otherwise untouched.

**Did not rename the file or split it further.** 1,700 lines with a store and a
picker extracted is defensible now, and the prompt is right that a full split is
too. I did not, and it was the biggest call of the session: renaming
`Tools/Name Picker.html` breaks `/Tools/Name%20Picker.html` for anyone who has
bookmarked or projected it, and makes the board `href` a shared-file request that
has to land in the same commit as my rename or the card 404s. With roughly twenty
other sessions in this repo, a two-file atomic change across an ownership boundary
is the thing most likely to go wrong. **The URL still works and the board needs no
edit.** Losing the space is a good idea for a session that also owns `index.html`.

**Did not persist the fair-rotation round.** It is in memory, so a mid-period reload
starts the round over. Storing it needs a fourteenth key, and the honest reason not
to is that I do not know what a teacher wants: is a reload the same period, or the
next one? Getting it wrong is worse than restarting, because a stored round that
outlives the period silently refuses to call the students who "already had a turn"
yesterday.

**Did not fix `np_history` growing forever.** The History tab says "All names picked
this session" and the info banner says "No picks yet today", but the key is never
cleared, so it accumulates across days and the tab shows last week's picks. `repair`
caps it at 500 entries, so it is bounded rather than unbounded now. The actual fix is
a policy decision — clear on the first pick of a new day, or keep it and relabel the
tab honestly — and it belongs with whoever decides what "session" means here. Same
shape as v7 §9's Faire Weekend report-phase question.

**Did not add a "who's due" display.** `leastPicked()` is written and tested in
`np-pick.js` and nothing calls it. Fair rotation made it much less necessary; the
Stats tab's existing "Least Picked" sort covers the same need. Left as a two-line
wiring job for whoever wants it in the footer.

**Did not touch the rarity system, soundboard, tournament mode, sudden death or
achievements.** All working, none of them storage or fairness.

---

## Next session

Ordered by value per effort.

1. **Decide `np_history`'s day boundary** — small, and it fixes a tab that currently
   lies about what it shows. The decision is one line either way; somebody just has
   to make it.
2. **Rename `Name Picker.html` to `name-picker.html` and update the board `href`**,
   from a session that owns `index.html` (prompt 21's territory). Both edits in one
   commit. My folder is already `Tools/name-picker/` so the pairing is done; this is
   just the page and the link.
3. **The two `gvb-save` requests above** — a one-line `try` in `load()` and a
   `filename` handler on `mountSaveBar`. Both tiny, both applicable blind, and the
   `load()` one closes a gap between the module and its own documented contract.
4. **A browser suite for the tools.** `play-games.mjs` drives seven games and zero
   tools, which is half of why the font hotlink went unnoticed. This tool is ready
   for one: `data-tab` attributes on every tab, and `#eraseStudentData`,
   `#exportRosters`, `#importRostersBtn`, `#fairRotation`, `#census`, `#keyTable`
   ids to drive and assert against. The beats I ran by hand this session all
   transcribe directly, and none needed engine knowledge:

   - export by hooking `URL.createObjectURL` and neutering
     `HTMLAnchorElement.prototype.click`, then asserting the envelope and the
     `a.download` name (v7 §3)
   - import by handing a `File` to `store.bundle.importFromFile`, sidestepping the
     file chooser entirely — no `waitForEvent('filechooser')`, no `page.__engine`
     branch
   - fairness by reading `np_history` after four multi-picks and asserting 28
     distinct names, zero duplicates, zero back-to-back
   - the corrupt-roster guard by seeding a truncated `np_rosters` and asserting
     `#countDisplay` is non-empty after load

   One warning from doing it by hand: the pick animations are timer-driven, so a
   headed run that loses focus stretches a four-pick loop past thirty seconds. v7 §6
   and locked decision #41 apply — the harness flags matter here more than they do
   for a rAF-driven game, because a throttled `setTimeout` clamps to about a second.
5. **Four pages were still hotlinking Google Fonts when I finished**, so v7 §5's
   "zero offsite requests site-wide" is still wrong — but by much less than the
   prompt says. It told me fifteen pages; a grep at the end of my session found
   **four**, because other threads vendored theirs while I worked:

   ```
   ./404.html                          ← the board's (prompt 21)
   ./index.html                        ← the board's (prompt 21)
   ./Projects/Ren-Faire-Claude/index.html
   ./Projects/daredevil_r4.html
   ```

   Moving target with this many sessions running, so re-grep rather than trusting
   that list. `grep -rl fonts.googleapis.com --include=*.html . | grep -v node_modules`
   is the check; `page.__blocked` is not, because `prepPage()` fulfils those
   requests locally.
6. **Persist the rotation, if a teacher says they want it** (see above). Needs a
   question answered, not code.
