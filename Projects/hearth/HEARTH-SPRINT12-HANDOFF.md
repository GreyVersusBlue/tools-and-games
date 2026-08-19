# Hearth v2 — Sprint 12 handoff ("What is handed down")

Deliverable: `hearth.html` (single file, ~225 KB, zero deps, runs from `file://`). Sprint 12 is the lore sprint the last two handoffs kept pointing at: the found objects and chronicle hooks finally become **heirlooms** and **legends**, the **audio listening pass six sprints owed is paid** — with numbers, not vibes — and the three named quality-bar leftovers (pop fill, wip works lost on save, the autosave gate) are closed. Save format goes to **v:8** (v:5–v:7 links still load; new fields read as defaults).

## Changelog (5 lines)

1. **Heirlooms.** The island now has *things*: objects with their own histories, held by someone. Two sources — a found object from the old stones now stays in its finder's pocket instead of evaporating into a log line, and, once per craft per island, a mastery leaves a made thing behind (the seed jar, the burl bowl, the whalebone knife, the little chair, the pocket scale). When a holder dies the thing **passes** — partner, then a grown child, then a friend, then the shelf in the hall — with a history entry on both sides and a chronicle `heir` entry ("the first handing down" is always chronicled). Someone who sails away in hunger leaves theirs on the shelf on purpose; if they ever row back, they go into the hall before going anywhere else. The person card lists what its subject keeps and what the thing last did.
2. **The telling.** Every fire story now leaves a thumbprint: each chronicle entry retold gets a `tl` count, and at three tellings it **grows** — a kind-specific line is folded into the story text permanently (`the landing`: "The boat in that story has been getting smaller, and the sea bigger, for years now."). Grown entries are marked in the chronicle and the export ("as it is told now"), the teller returns to a grown favorite at the end of a fire night, and new flavor lines let children demand the long version and elders lose the argument for the short true one.
3. **Midwinter.** Once a year, in the deep of winter, the village holds its own fire night — `tellStory` runs without the watcher and without crediting the watcher's faith account (the stone gets no credit for what the village does itself). This is what makes the lore self-sustaining: an untouched island still grows its landing myth by about year 3.
4. **The listening pass, measured.** The harness's new `twelve` mode plays every one-shot through an AnalyserNode on the real master bus and tabulates peaks: all thirteen sit in 0.04–0.20 with no clipping risk and no inaudibles, the sfx bus verifiably steps back under a storm (0.72 vs 0.95), and the storm bed itself peaks at 0.20. Three sounds were added under the reopened gate, all from the existing palette: a **stone tap** for the shrine's raising and for offerings left at it, and a three-note **way tune** in the season's key when a way is worked out. An answered prayer stays silent on purpose.
5. **The leftovers.** Works in progress survive the save now (v:8 packs `done/prog/paid/said`; a half-built ring no longer vanishes, the shrine no longer needs its faith re-arm to recover). `arrivalT` is damped ×(1+0.35·ways-discovered), so a village that has learned its ways fills slower — seed 7 lands at 41–42 on day 121 instead of pinned to the cap. And the autosave boot gate was still checking `v<=7` after the bump — the save harness caught it before it shipped.

**What I'd cut if it were too big:** the flavor templates for the shelf and the legends (the passing scenes carry the feature); never the midwinter fire.

## Numbers, measured

- **Determinism:** seeds 7 and 20260819, 30 days, two fresh runs each — identical `pack()` hashes (`13534fb5` / `9fcf1a52`), re-verified after every change including the midwinter telling (which draws from the same stream).
- **Soak:** 5 islands (3 fixed, 2 random) × 40 days, ~22,465 full-cast audits — **0 violations, 0 breadcrumbs.**
- **Save:** autosave round-trip through a real reload PASS (after the boot-gate fix below); a forged v7 save (4-field works, 5-field chronicle rows, no heirloom keys) loads clean with zero things and all works done; the eleven-mode v6 forgery still loads.
- **Sprint-12 systems (`node harness.mjs twelve`):** five forced masteries produce a made thing; killing its holder passes it ("the seed jar: Haka → Robra"), chronicled; three fire nights grow the landing story; a wip ring at prog 7.5 survives pack/unpack; the full listening-pass table prints and passes.
- **Depth, 120 days × 2 seeds:** 2–3 things in circulation per island by day 121 (made + found), the landing myth grown on both, ways 2–3, store bounded 517–560, **pop 42 / 49** (seed 7 well off the cap now; the rich island still fills — 49 is births-over-cap, which the birth rule has always allowed).
- **Heirlooms pass rarely by day 121** — holders are mid-life masters. Same shape as sprint 10's apprenticeship note: this system pays out on decade-old islands. Nothing to fix.
- File: **230,851 bytes (~225 KB)** of the ~250 KB budget (+10 KB this sprint).

## Decisions made without asking

- **Grants of credit are asymmetric on purpose.** The watcher's fire-click still feeds faith; the village's own midwinter fire explicitly does not (`tellStory(nat)` skips `noteAct`). The stone should never gain from what people did for themselves.
- **Stories grow one at a time** (one growth per fire night) and only ever once per entry — the chronicle stays a record that drifts, not a text that churns. The pre-growth text is not kept; the whole point is that nobody can get it back.
- **The heirloom pass order is partner → grown child → friend → shelf,** no randomness except whether the later passings are chronicled. Children never hold things (they inherit at growing up only via the normal order later).
- **An answered prayer makes no sound.** Everything else in the game answers; the quiet stone answering out loud would break the Godfellas ambiguity the whole system exists for.
- The found-object line changed from "goes on the shelf in the hall" to the finder keeping it — sprint 10's shelf line was written before there was anywhere for a thing to go next.

## Issues / complications I hit

- **A `//` comment ate half a line.** The arrival-timer line is one of the expression-dense chains sprint 11 warned about; appending a line comment commented out the `if` that followed on the same line. The parse check caught it; the fix is the standing rule — `/* */` only, anywhere near dense lines.
- **The autosave boot gate still said `v<=7`.** `pack()` went to v:8, `loadHash` was updated, but the localStorage boot path had its own copy of the version check. The save-mode harness failed on a day-1 island and pointed straight at it. If there is ever a v:9, grep for `o.v>=5` — there are **two** gates.
- **The first depth runs grew zero stories** because the entries the fire reliably retells are the chronicle's oldest — and `landing`, `name`, `temper` weren't in the growth table. The landing is retold at literally every fire night (tl=5 by year 6). Lesson: the growth table must cover whatever the *sampler* favors, not whatever seems dramatic.
- **The listening pass measured silence at first:** `master.gain` is stamped from `audioOn` when the graph is built, so enabling audio after `startAudio()` left the bus muted. Also, comparing hammer peaks clear-vs-storm is confounded — the analyser hears the rain bed under the hammer — so the ducking assertion moved to the bus gain the game actually applies.
- Headless Chromium needs `--autoplay-policy=no-user-gesture-required` for a running AudioContext; the harness launches with it always (harmless elsewhere) and skips with a FAIL if the context clock doesn't advance.

## Quality-bar leftovers, for sprint 13

- **The made-thing names are global constants** — two islands both produce "the whalebone knife." Per-seed variation (materials, a maker's flourish) would be cheap texture if wanted.
- **The shelf has no art.** Things on the shelf in the hall exist only in prose; a two-pixel row inside the hall when `things.some(t=>!t.holder)` would be a nice touch.
- Grown stories never influence *behavior* — a child who demands the long version doesn't walk to the landing beach. The lore is currently entirely narrative.
- The rich-island cap overshoot (49 via births) is pre-existing and mild; if it grates, the `popCap()+1` allowance in the birth rule is the number.
- The listening pass now exists as a harness mode; **run it whenever a sound is added or a gain touched** — it is one command and it prints a table worth eyeballing.

## Postscript: the file became a directory

After the sprint proper, the single `hearth.html` was split into components following the repo's convention (the orbital layout: classic scripts, not ES modules — the game must keep running from `file://`, which modules cannot):

- `index.html` — head + markup + the ordered `<script src>` list
- `css/hearth.css`
- `js/core.js → flavor.js → life.js → watcher.js → sim.js → render.js → audio.js → save.js → main.js` — the old single script cut at its own section banners, **in original order**. Top-level `let`/`const` share one global lexical scope across classic scripts, and all boot execution sits in `main.js`, so semantics are unchanged — proven, not assumed: the split build's 30-day `pack()` hash on seed 7 is byte-identical to the single file's (`4afab34f:27803`), and the whole harness suite passes against `index.html`.
- `hearth.html` is now a redirect stub that carries `location.hash` across the hop, because old share links hold a whole island in the hash. The homepage card points at `Projects/hearth/`.

Rules that now matter: **load order is the old file's order and is load-bearing** (add new files to the list in `index.html`, never reorder); don't add `"use strict"` (the code predates it); don't declare the same top-level name in two files; keep boot-time execution in `main.js`. The `/* */`-only comment rule near dense lines still applies everywhere.

## Where the thing stands

Sprints 1–12 in, ~225 KB of ~250 KB, one file, no dependencies, save v:8 (v:5–v:7 accepted), harness green across soak / determinism / save / depth / eleven / twelve. The island now keeps things as well as people: the comb out of the old stones has a pocket to live in and a list of hands to pass through, the landing story is bigger than the landing was, and once a year, in the deep of winter, they tell it all again whether you are watching or not.
