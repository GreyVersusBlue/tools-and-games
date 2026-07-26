# gvb-site-handoff-v2.md

Handoff from **session 2** (site version 3) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v1.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 2 got a real browser running for the first time and pointed it at the
board. The corner-ornament collision that v1 flagged as unverified turned out to
be real, and is fixed. A whole-site parse sweep turned up something worse:
**Castle Conundrum has been broken in production**, and still is. The seven
preview screenshots did not get captured. The verification tooling is now in the
repo at `tools/board-check/` so none of this has to be rebuilt from scratch
again.

---

## 1. How to render this site offline

This is the piece worth keeping. It took most of a session to work out.

```
cd tools/board-check
npm install       # also vendors three.js 0.160.0 and 0.169.0
npm run check     # integrity sweep + collision guard
npm run shoot     # reviewable PNGs into ./shots/
```

**Getting a browser.** Playwright and Puppeteer both fetch their browser binary
from a CDN at install time, and those CDNs are blocked in some sandboxes
(`x-deny-reason: host_not_allowed`). `@sparticuz/chromium` ships the Chromium
binary *inside the npm tarball*, and npm registries are usually allowed. Pair it
with `puppeteer-core`. That is the whole trick. On a normal machine with open
network, use regular Playwright instead and ignore this paragraph.

**Getting real fonts.** Without intervention every heading falls back to a
system serif, which makes any text measurement worthless and any screenshot a
lie. `harness.mjs` intercepts `fonts.googleapis.com/css2?...` and answers with
an `@font-face` sheet built from local `@fontsource` packages, resolving family
names to package names (`Zilla Slab` to `zilla-slab`) and picking the nearest
available weight. Adding a font to a project page usually just means
`npm i @fontsource/<name>`.

**Getting three.js.** `cdn.jsdelivr.net/npm/three@<ver>/...` is rewritten to a
vendored copy. Works through import maps, and the addons' relative imports
resolve correctly because the URL shape is preserved.

Everything else offsite is refused and logged, which is how you discover what
the site actually depends on at runtime. See §4.

---

## 2. What shipped this session

### The corner-ornament collision, fixed

The pin, the genre ribbon and the NEW POSTING flag all live in the top ~22px of
a quest card. The eyebrow is centred text that grows toward both corners as the
string gets longer. v1 warned these three were "laid out by arithmetic, not by
eye." They were, and they touched.

Measured across nine viewport widths: **10 real overlaps**, all flag-against-
eyebrow, on the four `data-new` cards, at 700px (2 col, 323px cards) and 1024px
(3 col, 317px cards). Worst was Integer Foundry at 1024, a 4x5px overlap.

Fix is one line plus a comment block:

```css
#quest-board .notice { padding-top: 2.15rem; }
```

A reserved band rather than per-card arithmetic, so it stays correct for any
eyebrow string and any tag name added later. Scoped to `#quest-board` because
only quest cards carry ribbons or flags. All 13 of them carry a ribbon, so none
gets dead space out of it. After: **0 collisions at every width, tightest
vertical gap 7.1px.**

**A measurement trap worth not falling into twice.** The first pass measured
horizontal proximity only and reported the problem as far worse than it was
(a claimed −4.6px flag overlap and a −3.4px ribbon overlap, when in truth the
ribbon never collided at all). Two boxes near each other on one axis are not
overlapping. `check-collisions.mjs` measures true 2D rectangle intersection
against the eyebrow's actual glyph run, obtained with a `Range` rather than the
block box. Do not simplify it back.

### `tools/board-check/` (new)

Dev-only, not linked from the board, gitignores its own `node_modules`.

| Script | Does |
| --- | --- |
| `check-integrity.mjs` | parses every `.js`/`.mjs`, every inline `<script>`, every `.json`. Exits 1 on failure. |
| `check-collisions.mjs` | the corner-ornament guard above. Exits 1 on failure. |
| `shoot-board.mjs` | renders each breakpoint, the `data-new` cards, filter active, suite lit, services, no-JS, and the 404 as served from a subpath. |
| `capture-previews.mjs` | **unfinished**, see §4. |

The server mirrors GitHub Pages by serving `404.html` for any miss including
deep subpaths, so the 404 actually gets exercised and its root-absolute links
get checked.

### Version line

Bumped to `version 3`. Keep bumping it.

---

## 3. What the browser confirmed

Things v1 could only assert, now observed:

- Ledger rail builds from the DOM: `ALL 13 · SIM 6 · CRPG 2 · EXPLORE 2 ·
  NARRATIVE 2 · PUZZLE 2`. Filtering to Sim leaves exactly 6 cards, flips
  `aria-pressed` on one chip only, and the live region reads "showing 6 sim
  postings".
- Suite cross-link lights all 3 of 3.
- 404 links are all root-absolute (`/`, `/#quests`, `/#pathfinder`,
  `/#services`). `shoot-board.mjs` now fails loudly if a relative one appears.
- No horizontal overflow at 390, 700, 1024 or 1280.
- Graceful degradation of previews is real: exactly 7 clean 404s for the missing
  JPEGs, no broken-image icons, no layout shift.
- Tab order starts at the chips, then threads cards, suite marks and ribbons.

**One correction to v1's implied behaviour.** The wax seals *do* render with JS
disabled. They are static HTML with static CSS. Only the ledger rail, the tag
ribbons and the NEW flags are JS-injected. (This was briefly misdiagnosed
because the no-JS screenshot was cropped at the same pixel offset as the JS one,
forgetting that the missing rail shifts everything up about 100px. Crop by
element, not by coordinate.)

---

## 4. The important one: Castle Conundrum is broken

**`Projects/Castle Conundrum/src/npc.js` does not contain JavaScript.** It
contains JSON, a near-duplicate of `data/npcs.json` (same three NPC ids, not
byte-identical content). `src/main.js` line 8 does
`import { NPC } from './npc.js'`, the module fails to parse with
`SyntaxError: Unexpected token ':'`, and the game hangs on
"Summoning stonework…" forever.

It is in the v2 zip, so it predates session 2. Session 1's issue #2 fixed the
missing `index.html` and verified `ui.css` and `main.js` *resolve*, which they
do. Nobody ran the game. **Resolving is not parsing.** That is exactly why
`check-integrity.mjs` now exists.

This card is one of the four flagged `data-new` on the board, so the most
prominently promoted quest on the site is a dead link in practice.

The `NPC` class source appears to be gone. The rest of the code needs it to
provide:

| Member | Used by |
| --- | --- |
| `id`, `name` | `quest-manager.js` |
| `group` (a `THREE.Object3D`) | `interaction.js` raycast |
| `talking`, `dialogueState` | `quest-manager.js` |
| `new NPC(def, scene, polyhavenBase)` | `main.js` |
| `await build()` | `main.js` |
| `update(dt, camPos)` | `main.js` loop |
| `facePlayer(camPos)` | `main.js` |
| `getDialogueLines()` | `quest-manager.js`, must honour `dialogueState` of `default` / `hasKeystone` / `afterVictory` and pass through a `{RIDDLE}` token |

`data/npcs.json` has everything the constructor needs: per-NPC `placeholder`
(a colour and an optional `heldProp` glTF path), `position`, `facing`, `patrol`,
and the three dialogue states. Reconstructing the class is maybe 100 lines, but
the placeholder body geometry is a visual decision that nobody has made yet, so
it wants a human in the loop rather than an invented answer.

Everything else on the site parses. The sweep covers 164 units (57 JS files, all
inline scripts across 25 HTML files, 83 JSON files) and finds exactly this one.

---

## 5. External runtime dependencies

The offsite request log turned these up. Four games break if somebody else's
host has a bad day.

| Project | Depends on |
| --- | --- |
| Aphelion | `cdn.jsdelivr.net` three@0.160.0 |
| Castle Conundrum | `cdn.jsdelivr.net` three@0.169.0, `dl.polyhaven.org` textures |
| The Fourth Quarter | `cdn.jsdelivr.net` three@0.160.0 |
| Golden Hour | `dl.polyhaven.org` sand texture |

Golden Hour already vendors three.js locally in `libs/`, so the pattern for
fixing the other three is sitting right there in the repo. Vendoring is
mechanical and low risk. The Poly Haven textures need a licence check before
committing them (Poly Haven is CC0, so this is likely fine, but confirm).

---

## 6. Backlog state

| Item | State |
| --- | --- |
| Open the board in a browser and check it | **Done.** Tooling committed so it stays cheap. |
| Corner-ornament collision | **Done**, with a regression guard |
| Whole-site parse integrity | **Done**, with a regression guard |
| Capture the seven preview screenshots | **Not done.** Pipeline exists, see below |
| Per-project OG tags | **Untouched**, still blocked on screenshots |
| Adopt `gvb-save.js` in The Fourth Quarter | **Untouched.** Zero adopters still |
| Castle Conundrum `npc.js` | **Broken.** New, and the top of the list |
| Vendor CDN dependencies | **New**, not started |
| Hover-unfurl previews | Mechanism done, images missing, **mechanism still never actually executed** |

---

## 7. Why the previews did not happen

Two reasons, and the honest one first.

**Visual review was unavailable.** The session's image-viewing capability worked
for the first stretch (which is how the flag collision got caught) and then
stopped returning anything for the rest of it. The preview spec in
`assets/previews/README.md` is explicitly a judgment call: grab the frame that
shows the game *playing*, not a title screen, subject centred-left. Producing
seven JPEGs, never looking at them, and dropping them into the live hover
previews would have been worse than shipping nothing. So: nothing shipped.

**The driving is genuinely hard.** `capture-previews.mjs` loads all seven pages
successfully, but:

- Integer Foundry and Faire Weekend produced **byte-identical frames** across a
  nine second window, meaning nothing advanced and the capture is an idle
  opening state, exactly the title-screen case the spec warns against. Both are
  build-something games; getting a real frame means actually playing them.
- The 3D projects run on software WebGL in a sandbox and are slow enough that
  `Input.dispatchKeyEvent` times out mid-scene. They probably need real GPU
  access.
- Castle Conundrum cannot be captured at all until `npc.js` is repaired.
- Golden Hour's sand texture is offsite, so it renders wrong anywhere
  `dl.polyhaven.org` is unreachable.

The plumbing (browser, fonts, three.js, correct 33:20 capture aspect) all works.
What is left is per-game play scripting plus someone with working eyes.

---

## 8. Locked decisions

Everything in v1 §3 still stands. Added:

10. **`#quest-board .notice { padding-top: 2.15rem }` is load-bearing.** It is
    the reserved band the corner ornaments live in. Removing it reintroduces the
    overlaps. `check-collisions.mjs` will catch that.
11. **Collision measurement is 2D.** Horizontal proximity is not overlap. See
    §2.
12. **`tools/board-check/` stays out of the served experience** and gitignores
    its own dependencies. It is dev tooling in the repo, same rationale as
    Ren-Faire's test scaffolding (v1 §3.4).
13. **A check that only prints is a check that gets ignored.** Both checkers
    exit non-zero. Keep that.

---

## 9. Suggested next session

Roughly in order of value per effort:

1. **Repair `Castle Conundrum/src/npc.js`.** A promoted, `data-new` card is
   dead. §4 has the full required API and the data file has everything the
   constructor needs. Decide the placeholder body look with a human.
2. **Vendor the three.js CDN dependencies** for Aphelion, Castle Conundrum and
   The Fourth Quarter, copying Golden Hour's `libs/` pattern. Mechanical, wide,
   makes four games durable.
3. **Run `npm run shoot` and actually look at `shots/`.** Ten PNGs covering
   every state that matters. Cheap now.
4. **Capture the seven previews**, on a machine with GPU access and with
   somebody able to view the output. Unblocks per-project OG images.
5. **Per-project OG tags**, reusing those screenshots.
6. **Adopt `gvb-save.js` in The Fourth Quarter** as the reference integration.

Remember to bump the version line to `version 4` and write
`gvb-site-handoff-v3.md` before signing off.
