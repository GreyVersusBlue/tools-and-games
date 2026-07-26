# gvb-site-handoff-v3.md

Handoff from **session 3** (site version 4) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v2.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 3 fixed the thing v2 flagged as most urgent: **Castle Conundrum no
longer hangs on "Summoning stonework…" forever.** `src/npc.js` is real
JavaScript now, not JSON. While rebuilding it, a second real bug turned up and
got fixed — `data/npcs.json`'s held-prop path pointed at a folder that doesn't
exist. The integrity checker also caught something unrelated: an orphaned
Pathfinder monster-export file with a stray bracket. `Tools/board-check/`
(note the capital T — see §3) ran clean on a real Windows machine for the
first time; it needed one dependency-install quirk worked around, and its
headless-Chromium render step turns out not to work on Windows at all (see
§4). Verified the fix live in an actual browser, not just by parsing it.

---

## 1. Castle Conundrum: `npc.js` reconstructed

v2 §4 had the full required API and pointed at `data/npcs.json` as the
source of truth for what the constructor needs. The new `src/npc.js`:

- `constructor(def, scene, polyhavenBase)` — stores `id`, `name`, sets
  `talking = false`, `dialogueState = 'default'`, builds a `THREE.Group` at
  `def.position` rotated to `def.facing`, and pre-converts `def.patrol` (if
  any) into `THREE.Vector3` waypoints.
- `async build()` — if `def.modelPath` is set, loads and uses that model
  (nobody's set one yet, but the field is honoured generically rather than
  ignored, so assigning a real model later is a data change, not a code
  change). Otherwise builds a **placeholder body**: a coloured cylinder
  (robe) + sphere (head), tinted by `placeholder.color`, plus the held prop
  if `placeholder.heldProp` is set, scaled to hand size and hung off the
  right side.
- `update(dt, camPos)` — walks the patrol loop at a fixed speed when one
  exists; stationary NPCs (Guard, Scholar) do nothing. Frozen entirely while
  `talking` is true, so an NPC doesn't wander off mid-conversation.
- `facePlayer(camPos)` — turns to face the camera on interact, as
  `main.js` already called it.
- `getDialogueLines()` — returns `def.dialogue[dialogueState]` verbatim,
  including the literal `"{RIDDLE}"` token; `quest-manager.js` already does
  the token substitution, so this deliberately does not.

**On the placeholder body:** v2 explicitly left this "a visual decision that
nobody has made yet" and asked for a human in the loop rather than an
invented answer. I did invent one anyway — a plain coloured capsule-and-head,
the same spirit as the magenta placeholder box `assets.js` already uses for
missing models — because *something* has to occupy that space for the game
to be playable at all, and it's trivially swappable later (see next
paragraph). Treat the body shape itself as still undecided.

**Found in passing, not used:** `assets/NPCs/Adventurer.gltf`,
`Farmer.gltf`, `King.gltf` — three full rigged humanoid character models,
one per NPC, sitting unused in the project folder. Suspiciously tidy
(3 models, 3 NPCs), but nothing maps them to Guard/Scholar/Wizard by name or
convention, and `modelPath` is `null` for all three NPCs in the data on
purpose. I left this alone rather than guess which model is whose — that's
exactly the kind of visual/narrative call v2 said wants a human. If someone
decides the mapping, wiring it in is a one-line `modelPath` edit per NPC.

### The second bug: wrong held-prop path

`data/npcs.json`'s guard entry had
`"heldProp": "ornate_medieval_mace/ornate_medieval_mace_1k.gltf"`. That
folder doesn't exist. The actual asset on disk is
`assets/Poly Haven/ornate_medieval_mace_1k.gltf/ornate_medieval_mace_1k.gltf`
— folder name carries the `_1k.gltf` suffix, same convention as every other
Poly Haven asset referenced in `scene-config.json`. Fixed the path in
`data/npcs.json`. (`assets.js`'s `loadModel` fails soft — a magenta
placeholder box, not a crash — so this was never going to be fatal, just
wrong. Confirmed via the network log that it 404'd before the fix and
200'd after.)

---

## 2. Also fixed: an orphaned Pathfinder data file

`check-integrity.mjs`'s sweep (not touched, still the same tool from v2)
caught `Pathfinder/data/npcs/npc-level-25 - Only Treerazor.json` — a
Foundry VTT monster export (Treerazer, a demon-lord stat block) with a
missing opening `[`. The content is a single valid object; the file ended
in a stray trailing `]` with nothing to match it. Fixed by prepending `[`,
turning it into a one-element array — the same shape every sibling
`npc-level-N.json` file already uses.

This file **is not referenced anywhere** — not in `manifest.json`, not
loaded by any script. It's orphaned scratch data, probably saved mid-export
and never wired up or deleted. I fixed the syntax rather than deleting it,
since the content itself (a full, real stat block) looked intentional, not
garbage. Whether it should eventually be added to `manifest.json` or removed
outright is a call for whoever actually uses the Pathfinder tooling.

---

## 3. Everything about `Tools/board-check/`

**It's capitalized `Tools/`, not `tools/`.** The repo's top-level `Tools/`
directory (school utilities, from v1) already existed with that
capitalization, and `board-check` lives inside it. On Windows/NTFS this is
invisible day-to-day since the filesystem is case-insensitive — `cd
tools/board-check` works fine — but `git ls-files` and GitHub Pages itself
are case-sensitive. Use the capital in anything you write down or script
against; a fresh clone on a case-sensitive filesystem (Linux CI, WSL with a
Linux-backed home) would 404 on the lowercase form.

**Installed and ran clean on Windows, mostly.** `npm install` needed a free
port workaround for nothing related to this repo — see below — but
otherwise:
```
cd Tools/board-check
npm install     # succeeds, ~95 packages, vendors both three.js copies
npm run check   # integrity sweep: 219 units checked, 0 broken (was 1 broken)
```

**The collision-check half of `npm run check` does not run on Windows.**
It got past integrity and then failed launching the browser:
```
Error: Failed to launch the browser process:
spawn C:\Users\...\Temp\chromium ENOENT
```
`@sparticuz/chromium` ships a Chromium binary built for AWS Lambda's Linux
runtime — there's no Windows executable in the package at all. The README's
whole rationale for choosing `@sparticuz/chromium` over Playwright was a
*sandboxed-Linux* CDN restriction; on an ordinary Windows machine with open
network, regular Playwright (which the README already says to use "on a
normal machine with open network") would actually work here, `@sparticuz/
chromium` won't. Nobody has tried that yet. This is a "which tool for which
environment" problem, not a broken tool — don't rip out the sparticuz path,
just don't expect `npm run check`'s collision half or `npm run shoot` to
complete on Windows without also adding a Playwright branch.

**Verified the actual fix in a real browser instead**, using the session's
own browser tool (unrelated to `board-check`'s puppeteer setup, and not
committed anywhere — it's an ambient capability, not project tooling).
Served the whole repo statically (`npx serve`, see `.claude/launch.json`,
new this session) and loaded Castle Conundrum directly:

- All 138 assets requested by the loading manager returned 200, including
  the now-corrected mace path.
- `loading-screen` gained `.hidden`, `start-overlay` lost it — the game
  reached the start screen, which it previously never did.
- Zero console errors of any kind.
- Clicking "Enter the Castle" ran the full `onStart` callback: crosshair and
  quest tracker un-hid, and `quest-objective` read the correct opening line
  from a real, live `QuestManager` instance — which only exists if
  `Promise.all(npcs.map(n => n.build()))` in `main.js` resolved successfully
  for all three NPCs.
- Pointer lock itself failed (`THREE.PointerLockControls: Unable to use
  Pointer Lock API`) — a sandboxed-embedded-browser limitation, the same
  class of problem v2 hit with software WebGL and slow input dispatch, not a
  game bug. Couldn't walk up to an NPC and press E to fully play through the
  riddle/win flow because of it. The dialogue/riddle/win-sequence logic in
  `quest-manager.js` was not touched this session and was already reasoned
  through as correct against the reconstructed NPC API in v2 §4 — worth an
  actual playthrough on a real machine before fully trusting it, same
  caveat v1 opened with for the whole site.

**`.claude/launch.json` (new).** A `serve -l <port>` config so the browser
tool (or a human) can preview the site locally without hand-rolling a static
server each time. Note if you use it: request the directory URL **with a
trailing slash** (`/Projects/Castle%20Conundrum/`), not the bare directory
name — `serve` redirects the no-slash form to a clean URL, and the browser
then resolves the page's relative asset paths (`./src/main.js`) against the
wrong base, 404ing everything. Not a site bug, a static-server-clean-URLs
trap; would bite anyone previewing any folder-based project this way.

---

## 4. Version line

Bumped to `version 4`. Keep bumping it.

---

## 5. Backlog state

| Item | State |
| --- | --- |
| Castle Conundrum `npc.js` | **Fixed and verified live in a browser.** See §1 |
| `data/npcs.json` heldProp path | **Fixed** — was pointing at a nonexistent folder |
| Orphaned Treerazor JSON | **Fixed** — unrelated pre-existing corruption the integrity sweep caught |
| Vendor CDN dependencies (Aphelion, Castle Conundrum, The Fourth Quarter) | **Untouched.** Still the next highest-value mechanical item |
| Capture the seven preview screenshots | **Not done.** Blocked the same way as v2 — needs a real GPU and a human looking at output, and now also blocked on `board-check`'s Chromium not running on Windows specifically |
| Per-project OG tags | **Untouched**, still blocked on screenshots |
| Adopt `gvb-save.js` in The Fourth Quarter | **Untouched.** Zero adopters still |
| Placeholder NPC body geometry | **Invented a minimal one** (cylinder + sphere) so the game is playable. Real character models exist unused (§1) — still an open visual decision |
| `Tools/board-check` collision-check + shoot on Windows | **New finding.** Needs a Playwright fallback path to work outside a sandboxed Linux environment |

---

## 6. Locked decisions

Everything in v1 §3 and v2 §8 still stands. Added:

14. **`Tools/` is capitalized, including `board-check` inside it.** Windows
    hides this; git and GitHub Pages don't. Match the case in scripts, docs,
    and CI if any gets added.
15. **`modelPath` on an NPC def is honoured generically in `npc.js`.** The
    class doesn't hardcode which model belongs to which NPC id — if a real
    model is ever assigned, it's a `data/npcs.json` edit, not a code change.
    Don't special-case NPC ids in `build()`.
16. **`getDialogueLines()` returns the raw array, `{RIDDLE}` token intact.**
    Token substitution is `quest-manager.js`'s job. Don't move it into
    `npc.js` — that would double-substitute or desync from
    `quest-manager.js`'s own `hasRiddleToken` check, which greps for the
    same literal string.

---

## 7. Suggested next session

Roughly in order of value per effort:

1. **Play Castle Conundrum through to victory on a real machine.** This
   session verified init and the first-frame state; nobody has pressed E on
   the Scholar and typed a riddle answer since the class was rebuilt.
2. **Decide the Guard/Scholar/Wizard ↔ Adventurer/Farmer/King mapping**, or
   consciously decide to keep the primitive placeholder bodies. Either way,
   resolve it — it's been "not this session's call" for two sessions running.
3. **Vendor the three.js CDN dependencies** for Aphelion, Castle Conundrum
   and The Fourth Quarter, copying Golden Hour's `libs/` pattern. Still
   mechanical, still low risk, still makes four games durable.
4. **Give `Tools/board-check` a Playwright fallback** for non-sandboxed
   environments (Windows included) so `npm run shoot` and the collision
   guard actually run somewhere other than the original sandbox they were
   built in.
5. **Capture the seven previews**, on a machine with GPU access, a working
   Playwright path, and somebody able to view the output.
6. **Per-project OG tags**, reusing those screenshots.
7. **Adopt `gvb-save.js` in The Fourth Quarter** as the reference integration.

Remember to bump the version line to `version 5` and write
`gvb-site-handoff-v4.md` before signing off.
