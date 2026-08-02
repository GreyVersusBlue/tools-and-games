# 18 — Name Picker

You are working on the Name Picker, a classroom tool on greyversusblue.com under the board's "Town
Services" section. It picks students at random from a roster. Round 1 gave it a full data-safety
pass, moved all thirteen storage keys onto the shared save module, and fixed a real fairness bug in
the picking logic. This prompt is self-contained, but read the round-1 notes first (below) — this
round's task list is short and specific because of what that session already found.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Name Picker.html` (2,045 lines, 125 KB)
- `Tools/name-picker/` — `np-store.js`, `np-pick.js`, `test/smoke.mjs`, `test/blocked-storage.html`,
  `fonts/` (nine vendored `.woff2` files plus README and licences), `README.md`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions are working on other projects in this same repo right
now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. The board `href` still points at `Tools/Name%20Picker.html`, space and all — see below. |
| Every other file in `Tools/` | Prompts 16, 17, 19, 20. `Tools/board-check/` is prompt 21's. The Bestiary Gallery that used to sit here is gone; don't reference it. |
| `assets/js/gvb-save.js` and its test | The shared save module, now backing all thirteen of your keys through `Tools/name-picker/np-store.js`. **You may still not edit the module itself.** Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't. The page deliberately **stayed** at `Tools/Name Picker.html`, space and all,
through round 1 — renaming it to `name-picker.html` needs the board `href` changed in the same
commit, and that edit belongs to whoever owns `index.html` (prompt 21), not to a solo run of this
prompt. See the task list.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section, which is not boilerplate here.
2. **`Claude Prompts/notes/18-name-picker-notes.md`, your own session's notes from round 1.** It has
   the exact beats needed for the task-one browser suite below, already hand-verified in a real
   browser — export/import, the fairness assertion, the corrupt-roster guard. `Claude
   Prompts/archive/` holds earlier rounds' prompts and notes if you need more history than that.
3. `assets/js/gvb-save.js` and `assets/js/README.md`. All of it. `Tools/name-picker/np-store.js` is
   the worked example of adopting it against thirteen keys, four of them arrays or bare strings.
4. `gvb-site-handoff-v8.md` §4 (the shared save module: one adopter to eleven, five gaps found) and
   §9 locked decisions **#48** (`mountSaveBar`'s `filename`/`labels` overrides) and **#49** (the
   `load()`/`getItem` guard and the construction-time `typeof localStorage` throw) — both are this
   project's own findings from round 1, now applied. `gvb-site-handoff-v7.md` §1 and §2 are still the
   best explanation of the `repair`-vs-`migrate` split if you need the background.
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
6. Locked decision #7 in v1 §3 — the site's easter-egg pattern. The Konami-code retro theme and the
   Lucky Student of the Day feature are both real, both preserved, and that decision is about how the
   board handles the same idea.

## Student data: this is the part that matters

**This tool stores student names in `localStorage` on whatever machine it runs on.** Student names
are education records under FERPA. Round 1 gave this a full pass and it is in good shape now — the
rules below are what keeps it that way, not a to-do list.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint. True
  today (zero requests leave localhost once the page has loaded — the three Google Fonts hotlinks
  that used to be the exception are gone) and it must stay true through whatever you change.
- **Do not put real student names in the repo.** Round 1 checked the working copy and the full git
  history back to the original commit (`git show ef8f69c`) and found none — only three placeholders
  in the roster textarea's `placeholder` attribute (Aiden Smith, Brooklyn Jones, Charlie Patel), all
  obviously fake. Keep it that way: any fixture or test data you add is fabricated, never a real
  roster.
- **A visible, unmissable "clear all data" control exists: the 🔒 Data tab's "Erase All Student
  Data" button.** It clears exactly the six keys that hold student data (grouped as `roster` and
  `records` in `np-store.js`'s `GROUPS`, see below) and leaves the other seven — themes, prompts,
  options, the retro unlock — untouched, so a teacher clearing a class list doesn't also erase an
  earned easter egg. Keep that split if you touch this area; a single "clear everything" button is
  the wrong shape for a shared classroom machine.
- **The UI says in plain language what is stored and where.** The Data tab opens with a sentence
  saying everything stays in this browser on this computer, no account, server or analytics, zero
  network requests — then a live census and a table of all thirteen keys naming which erase button
  clears each. If you add a fourteenth key, it needs a row in that table and a group in `GROUPS`.

**Export is a file of student names leaving a managed machine, and the tool already treats it that
way:** the filename is `name-picker-roster-backup-YYYY-MM-DD.json`, not the shared save module's
generic `name-picker-save-…`, and the confirm dialog states the exact name count before writing
anything, plus guidance to keep the file on a school-managed drive rather than a personal cloud
folder or a shared machine's Downloads. If you touch export, keep both of those.

## What is actually here

This is a mature, well-tested tool now. **2,045 lines, 127,747 bytes (about 125 KB) in `Tools/Name
Picker.html`**, plus `Tools/name-picker/`: `np-store.js` (496 lines, the storage layer), `np-pick.js`
(150 lines, fair rotation and Fisher-Yates), `test/smoke.mjs` (620 lines, 207 assertions),
`test/blocked-storage.html` (97 lines, 10 assertions), `fonts/` (nine vendored `.woff2`, README,
three upstream licences), and its own `README.md`. Title: "Name Picker". Tagged with the school stamp
under Town Services.

**Student-data safety is thorough.** No real student names anywhere in the file or its git history
(checked back to the original commit). A new **🔒 Data tab** states plainly that everything stays in
this browser, no account, server or analytics, zero network requests — then a live census and a table
of all thirteen keys naming which of two erase buttons clears each. Confirm dialogs state real counts
before erasing (*"This removes 28 student names, 1 roster, 28 sets of pick counts…"*) and before
exporting. Export files are named `name-picker-roster-backup-YYYY-MM-DD.json`, not the shared
module's generic `name-picker-save-…`.

**Thirteen `np_` keys, all on `assets/js/gvb-save.js` via `np-store.js`, zero direct `localStorage`
call sites left in the page.** `grep -c localStorage "Tools/Name Picker.html"` → 3, and all three are
inside a code comment, not live reads. **All thirteen key names are unchanged from before round 1,
and so is every byte already on disk** — the four array-valued and five bare-string keys (`np_theme`
is literally `"medieval"`, not JSON) needed a `boxed()` adapter so `gvb-save`'s `{...state, __v:
version}` spread never touches what's actually written to storage. Keys are grouped into three named
groups, in a table in code (`GROUPS` in `np-store.js`), not a comment:

```
roster    np_rosters  np_current  np_lucky              student names — cleared by "Erase All Student Data"
records   np_stats    np_history  np_hof                names + what they did — cleared by the same button
prefs     np_theme  np_prompts  np_options  np_crazy     no student data — survives that erase
          np_lucky_enabled  np_retro_active  np_retro_unlocked
```

`np_lucky` sits in `roster`, not `prefs`, on purpose — it looks like a toggle but it stores one
student's name.

**The fairness bug is fixed.** Before round 1, every pick was an independent uniform draw with no
memory of who'd already gone — over a 28-student roster that left roughly ten students never called
across a full round (measured: 64% coverage), because `np_stats`/`np_history` were written every pick
but never read back. There's now a proper fair rotation — draw without replacement within a round,
refill when the pool is exhausted, exclude the previous pick from the first draw of a new round — as
a new **"⚖️ Fair rotation" option, on by default**. `makeGroups()`'s old `sort(() => Math.random() -
0.5)` shuffle, measurably biased (worst deviation 2,438 of an expected 3,333 over 20,000 shuffles),
is now real Fisher-Yates (worst deviation 68). The rotation lives in memory per page load, not in
storage — a reload starts a clean round, deliberately.

**Zero offsite requests.** The three Google Fonts hotlinks (Bungee, Outfit, Press Start 2P) are
vendored: nine `.woff2` files, 96.9 KB on disk, but a typical first paint only fetches 41.5 KB
(Bungee 400, Outfit 400/600); the `latin-ext` files load only for a name with a non-ASCII glyph, and
Press Start 2P — the retro-theme font — is never fetched until the Konami code unlocks it. `grep -c
"fonts.googleapis.com\|fonts.gstatic.com" "Tools/Name Picker.html"` → 0.

**A test suite exists and is this project's own.** `node "Tools/name-picker/test/smoke.mjs"` → 207
passed, 0 failed (fresh run, this session). `test/blocked-storage.html` needs a real browser (a
throwing `localStorage` property getter can't be reproduced in plain Node) — 10 of 10 pass there,
per round 1's notes; re-verify in a browser if you touch storage construction. `npm run tools` from
`Tools/board-check/` already opens this page headless and asserts a real title, no offsite requests,
and no console errors — 1 of 18 checks across six Tools pages, all passing.

**Also fixed this round, worth knowing about:** the Hall of Fame ticker used to die permanently on
one entry with no `tier` field (`e.tier.toLowerCase()`, unguarded); a non-array roster value used to
crash the whole page on load via `updateRosterUI()`, or crash on click via `.join()` — the store now
refuses a bad blob and drops one unusable entry rather than losing the whole set to it; and all
~15 toggle-able options (sound, confetti, cold-call, rarity, sudden-death, the HOF ticker, mode,
speed, and more) now persist in one new key, `np_options` — previously only 4 of them survived a
reload.

**The Konami-code retro theme and "Lucky Student of the Day" are real features, preserved exactly.**
Treat them the same way you would any other feature — this repo likes easter eggs, and locked
decision #7 records that the Anathema Archive's is the origin of the pattern.

**This project's own two `gvb-save.js` requests were both applied by prompt 21**, now locked
decisions #48 and #49 in `gvb-site-handoff-v8.md` §4 and §9: `load()`'s `getItem` call is now
guarded (closes the hard crash this project's own test suite hit — `Error: The operation is
insecure. at Object.getItem`), and `mountSaveBar` gained a `filename` override (the reason this tool
wanted it: `name-picker-roster-backup-…json` instead of the generic default). Both are cited, not
repeated, in the task list below.

## Your task

Round 1 was the big one: student-data safety, the full `gvb-save.js` adoption across all thirteen
keys, and the fairness bug fix. What's left is smaller and more specific.

**Task one, the highest-value item: build the `play-games.mjs` browser suite for this tool.**
`npm run games` covers six games and zero tools — `Tools/board-check/tools.mjs` (new this round)
opens this page headless and checks title/offsite/console, but nothing drives it: no click, no
export, no fairness assertion. That's half of why the font hotlinks went unnoticed for as long as
they did. This tool is ready for one and it is close to transcription, not invention — round 1's own
session hand-ran every beat a suite needs and wrote down exactly how, in
`Claude Prompts/notes/18-name-picker-notes.md`'s "What I verified" section:

- **Export**, by hooking `URL.createObjectURL` to read the exact bytes a download would write and
  neutering the anchor click so nothing actually saves — assert the envelope (`format: "gvb-save"`,
  `game: "name-picker"`), the `a.download` filename (`name-picker-roster-backup-YYYY-MM-DD.json`),
  and that `"__v"` never appears in the file.
- **Import**, by handing a `File` straight to `store.bundle.importFromFile` — sidesteps the OS file
  picker entirely, no `waitForEvent('filechooser')` needed.
- **Fairness**, by seeding a 28-name roster, running enough multi-picks to cover it, and reading
  `np_history` back off disk: assert 28 distinct names, zero duplicates, zero back-to-back repeats.
- **The corrupt-roster guard**, by seeding a truncated `np_rosters` value and asserting
  `#countDisplay` is non-empty after load — this is the bug round 1 fixed; the suite should prove it
  stays fixed.
- **The erase flow**, by seeding data, clicking `#eraseStudentData`, confirming, and asserting the
  six student-data keys are gone while the seven preference keys survive.

One warning, also from round 1's own hands-on run: the pick animations are timer-driven, so a
headed run that loses focus stretches fast. `gvb-site-handoff-v7.md` §6 and locked decision #41
apply here more than they do to a rAF-driven game — a throttled `setTimeout` clamps to about a
second, and only one browser suite should run at a time regardless (see Scheduling note below).

**Task two: decide `np_history`'s day boundary.** Small, but it fixes a tab that currently lies
about what it shows. The History tab's copy says "picked this session" / "No picks yet today," but
the key is never cleared, so after the first day it shows last week's picks too. `repair` already
caps it at 500 entries, so it's bounded rather than unbounded, but that's not the same fix. The
actual decision — clear on the first pick of a new calendar day, or keep everything and relabel the
tab honestly — is a policy call for Devon, not a coding problem, so surface the tradeoff and
implement whichever he'd pick if you can't ask directly. Same shape as `gvb-site-handoff-v7.md` §9's
Faire Weekend report-phase question.

**Not this project's job, flag it instead: renaming `Tools/Name Picker.html` to
`name-picker.html`.** Round 1 deliberately left it — the space and capitalization stayed so
`Tools/Name%20Picker.html` keeps resolving — but a rename now needs the board's `href` in
`index.html` changed in the same commit, and that file belongs to prompt 21, not to a solo run of
this prompt. If you think it's worth doing, write the exact before/after `href` into your
Shared-file requests section rather than touching `index.html` yourself. `Tools/name-picker/` is
already named right, so only the page and the link are left.

If task one and two are both done with session left over, worth a look:

- **The three levels.** Honors GT, Honors and Academic all use this; multiple rosters is a core case.
  `np_rosters` already handles it — check how well under real use, not just in the abstract.
- **Mobile and accessibility** were both addressed in round 1 (375×812 checked, `:focus-visible`
  added, nine `prefers-reduced-motion: reduce` rules) — re-verify rather than redo, and note in your
  notes if anything regressed.
- **`leastPicked()`** is written and tested in `np-pick.js` and nothing calls it. Fair rotation made
  it mostly redundant (the Stats tab's "Least Picked" sort covers the same need), so this is a
  two-line wiring job only if you specifically want a "who's due" display somewhere.

## Verification

A test suite exists and it should keep passing. Add to it — a folder you own, exit non-zero on
failure (locked decision #13) — don't start over.

- `node "Tools/name-picker/test/smoke.mjs"` → **207 passed, 0 failed.** Run this before you touch
  anything so you know the baseline holds, and again before you finish.
- `Tools/name-picker/test/blocked-storage.html` → **10 of 10 pass**, per round 1's notes. This one
  needs a real browser (a throwing `localStorage` property getter can't be reproduced in plain
  Node), so re-verify it by hand if you touch storage construction; don't assume it still holds
  just because the Node suite does.
- If you build the browser suite in task one, **the corrupt-data case is the one to verify by
  reintroducing the bug it guards** (locked decision #34): seed a truncated `np_rosters`, reload,
  confirm the page does not throw and the roster is dropped rather than crashing the load.
- **Test the export/import round trip against the real UI**, not just the module: export, erase via
  the Data tab, import, confirm the roster and pick counts come back exactly as they were.
- `grep -c "fonts.googleapis.com\|fonts.gstatic.com" "Tools/Name Picker.html"` → 0. `page.__blocked`
  is **not** the check (locked decision #44); `check-integrity.mjs`'s static offsite sweep is, and
  it's what `npm run check` below already runs.
- `cd Tools/board-check && npm run check` → currently in the high 320s to low 330s units checked,
  0 broken affecting this project (moving target while other sessions edit the repo; older prompts
  still say 235 or 298 — ignore those). Run it yourself before you finish for the exact number.
- `npm run social:check` → 22 notices, 22 already current, 0 out of date, 0 failed. Drift on your
  page means you edited inside the `gvb:social` markers.
- `cd Tools/board-check && npm run tools` → 18 checks, 0 failed, across six Tools pages including
  this one. This already runs a basic smoke pass on the page; it is not a substitute for task one.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/18-name-picker-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

Use these headings:

```
# Name Picker — session notes

## Student data
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any
real student names were in the file, what the tool now stores and where, whether a user can clear all
of it in one action, and whether the UI tells them the truth about it. That is the section that
matters most for a tool holding a class list — confirm round 1's answer still holds rather than
skipping it because it was already answered once.

- **What changed** — files touched and why, with paths. If you touched storage at all, **list every
  storage key and say what happened to it**; if you didn't, say so plainly and point at round 1's
  notes for the full table instead of repeating it.
- **What I verified** — actual commands, actual output. If you built the browser suite, this is where
  every beat it drives goes, with pass counts. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you're recommending the rename (see task list — you
  write the request, you don't make the edit). Any new `gvb-save.js` gap if you find one. Applicable
  blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. The easter eggs are a legitimate thing to leave alone once you know what they do.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
