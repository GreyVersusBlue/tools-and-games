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
are education records under FERPA. That is not a reason to stop building it — a name picker without
a roster is useless — but it changes what "done" means.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint, ever.
  The tool is currently clean on this and must stay clean.
- **Do not put real student names in the repo.** Any sample roster, test fixture or screenshot uses
  obviously fake names. **Check the current file for real names before you do anything else** — it
  has twelve storage keys and a roster feature, so a hardcoded class list is entirely plausible. If
  you find one, that is the first item in your notes and it comes out.
- **A visible, unmissable "clear all data" control is required.** This runs on a classroom machine
  that other people use. The tool currently has twelve separate keys, and a teacher has no way to
  know that or to clear them all.
- **Say in the UI what is stored and where.** One honest sentence. A teacher deciding whether to type
  twenty-eight real names into a web page deserves to know the answer is "this browser only, nowhere
  else".

Also worth thinking about: **an export is a file of student names leaving a managed machine.** If you
add export, that is the right feature, but the filename and the UI should not encourage saving it
somewhere careless. Name it plainly, don't default to a Downloads-and-forget flow, and say what it
contains.

## What is actually here

1,702 lines, 107 KB, one file. Title: "Name Picker". Tagged with the school stamp under Town
Services.

**Twelve `localStorage` keys across forty-six call sites**, all hand-rolled:

```
np_theme  np_stats  np_history  np_rosters  np_current  np_prompts
np_hof    np_lucky  np_lucky_enabled  np_crazy  np_retro_active  np_retro_unlocked
```

That is more storage surface than any game in the repo, including the two that went through a
dedicated save-system session. The error handling is inconsistent: some reads are wrapped in
`try/catch` with a sensible fallback (`loadStats`, `loadHistory`, `loadPrompts`), and some are bare
`JSON.parse(localStorage.getItem('np_rosters') || '{}')` with no guard at all — which means **a
corrupt roster entry throws on read and takes the page with it**, and the user has no way to recover
except knowing to clear site data. Read lines 1009–1042 and check that for yourself; it is the
concrete bug in this file.

`np_lucky`, `np_crazy`, `np_retro_active` and `np_retro_unlocked` look like easter eggs and an
unlockable retro theme. Treat them as features, not cruft — this repo likes easter eggs, and locked
decision #7 records that the Anathema Archive's is the origin of a pattern the board copied. Find out
what they do before you touch them.

**It hotlinks three Google Font families** — Bungee, Outfit and Press Start 2P — at lines 24 and 26.
v7 §5 claims the site makes zero offsite requests site-wide. That is wrong for fifteen pages, and the
reason nobody caught it is twofold: `prepPage()` in `Tools/board-check/harness.mjs` *fulfills* Google
Fonts requests locally from bundled `@fontsource` packages before the blocked-list check runs, and the
browser suites only ever drive the seven games, never the tools. None of your three families are among
the twelve already on disk in `Tools/board-check/node_modules/@fontsource/`, so you will be sourcing
these yourself. Press Start 2P is presumably the retro-theme font, so check whether it is needed on
first paint or only after an unlock — a font only an easter egg uses should not block the initial
render.

## Your task

There is no handoff backlog for this tool. It has never been the subject of a session.

**Task one, the highest-value item and it is a bug: fix the unguarded roster reads.** Four
`JSON.parse(localStorage.getItem('np_rosters') || '{}')` calls with no `try/catch`. One malformed
entry — from a failed write, a quota error mid-save, or a browser extension — and the page throws on
load with a roster the user cannot delete through the UI. That is a tool that eats a teacher's class
list and offers no way out.

**Task two, the structural fix that makes task one permanent: adopt
`assets/js/gvb-save.js`.** You are the best-fitting candidate in the repo. Twelve keys, forty-six
call sites, inconsistent error handling, no versioning, no validation, no export, and no memory
fallback — the module exists for exactly this.

What you get: validation so a corrupt blob is refused instead of thrown on, file export and import so
a roster survives a cleared browser or moves between the classroom desktop and a laptop, a
memory-backed fallback for browsers configured to block storage (**reading the `localStorage` property
throws outright** in that configuration — not `setItem`, the property access — which none of your
forty-six call sites survive), and one implementation of "refuse to load garbage".

Specifics that bit the first adopter, from v7 §1 and §2:

- **Keep every existing key exactly as it is** (locked decision #36). All twelve. `np_theme` stays
  `np_theme`. Changing one silently loses a teacher's rosters, and rosters are the thing that took
  the longest to type.
- **Think about whether twelve keys should become twelve slots or fewer.** The module is per-slot, and
  there is a real design question here: `np_theme` and `np_retro_unlocked` are preferences,
  `np_rosters` and `np_current` are data, `np_stats` and `np_history` and `np_hof` are records. Those
  three groups have different export, reset and validation needs — a "clear all data" that wipes the
  rosters but keeps the unlocked retro theme is the behaviour a user actually wants. **Grouping them
  is the interesting work in this task**, and doing it without changing the underlying key names is
  the constraint.
- **`defaults` may be a factory.** If any default involves anything non-literal, pass a function or
  `slot.reset()` hands back `null` — that gap was found by The Fourth Quarter's three random job
  applicants.
- **Fill-ins go in `repair`, not `migrate`** (locked decision #37). `repair` runs on **every** accepted
  load from every door — localStorage, an imported file, a pasted blob, and data the current build
  just wrote. `migrate` only runs on version drift. You have twelve keys of unversioned data on real
  machines right now, all of which read as version 0, so `repair` is where the compatibility work
  lives. Go looking for your version of the bug it exists for: a field added since the tool shipped,
  absent from existing data, used somewhere that turns `undefined` into a silent failure.
- **`mountSaveBar` takes a `buttons` option** and each button carries `data-gvb="export|import|reset"`
  so a driver can click it without depending on label text or order. **Do not mount "reset" beside an
  existing clear button** if the tool already has one — two data-erasers side by side is the exact
  footgun that option exists to prevent.
- **Stop touching `localStorage` directly anywhere afterwards.** All forty-six call sites. Let the
  module do the probing.
- **Import relatively** — `../assets/js/gvb-save.js` — so any Node test can resolve it.
- **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`. Six projects read that
  file. Write the exact signature you need and work around it locally meanwhile. Given how much
  storage surface you have, you are the thread most likely to find a real gap — **that finding is
  valuable, so write it up properly.**

**Task three: vendor the three fonts.** Bungee, Outfit, Press Start 2P. Local `@font-face`, woff2 in a
folder you own, hotlinks deleted, only the weights the page uses. Consider loading the retro font
lazily if only an unlocked theme needs it. README naming source and licence, the way
`Projects/golden-hour-beach/assets/textures/README.md` does. Measure and report the total (locked
decision #42).

**Task four: audit and plan, then build what fits.** Worth an opinion:

- **Is the randomness actually fair?** This is a name picker's entire job, and the thing teachers
  notice. Does it pick without replacement within a round, or can it call the same student twice in a
  row? `np_stats` and `np_history` exist, so it appears to track calls — does anything use that to
  even out who gets asked? "Every student gets called before anyone gets called twice" is usually what
  a teacher wants and rarely what a naive `Math.random()` gives.
- **The three levels.** This gets used across Honors GT, Honors and Academic sections, so multiple
  rosters is a core case rather than an edge one. `np_rosters` suggests it is handled; check how well.
- **Mobile.** 375×812. A name picker is used standing up in front of a class, from a phone as often as
  a projector. This is a strong mobile case.
- **Accessibility, and the projector case.** This one is displayed to a room. Contrast and font size at
  the back of a classroom matter more than usual, and `@media (prefers-reduced-motion: reduce)` — used
  elsewhere in this repo — matters if the picker animates, which a picker usually does.
- **1,702 lines in one file** with twelve storage keys and an unlockable theme is at the point where a
  split is defensible. If you do it, `/Tools/Name%20Picker.html` stops resolving and the board `href`
  is a Shared-file request. Say plainly that the old URL breaks. This is also the moment to lose the
  space in the filename.

## Verification

This tool has no test suite, and it is the one in this set that most obviously needs one: storage
handling and fair-picking logic are both pure functions and both currently unverified. Put it in a
folder you own and make it exit non-zero on failure (locked decision #13).

- **Before you change anything, save a copy of all twelve keys' current values** from a browser that
  has used the tool, or fabricate a realistic set. You need it to prove existing data still loads.
- **Test the corrupt-data case explicitly.** Write garbage into `np_rosters` by hand, reload, and watch
  the page throw. That is the bug in task one, and locked decision #34 says you verify a guard-rail by
  reintroducing the bug it guards — so do it before the fix, then again after.
- **Test with storage blocked.** Chrome's site settings will do it. The tool should still run, not
  white-screen.
- Test the export/import round trip once it exists: export, clear everything, import, confirm the
  rosters come back intact.
- **Test fair picking empirically.** Run a few hundred picks against a roster of twenty-eight and look
  at the distribution. Numbers, not impressions.
- After vendoring, grep the file for `fonts.googleapis.com` → zero hits. `page.__blocked` is **not**
  the check; `prepPage()` fulfills those requests.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you
  finish, especially if you renamed anything.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited inside
  the `gvb:social` markers.

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
matters most for a tool holding a class list.

- **What changed** — files touched and why, with paths. **List every storage key and say what
  happened to it**; twelve keys is enough that the next session needs a table. Vendored font total in
  KB.
- **What I verified** — actual commands, actual output. Include the corrupt-data test before and
  after, the storage-blocked test, the export/import round trip, and the picking-distribution numbers.
  "Should work" is not verification.
- **Shared-file requests** — **read this one twice.** With forty-six call sites and twelve keys you
  are the most likely thread to find a real gap in `gvb-save.js`; write the exact hook signature and
  why existing hooks don't cover it. Plus a board `href` if you restructured. Applicable blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. The easter eggs are a legitimate thing to leave alone once you know what they do.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
