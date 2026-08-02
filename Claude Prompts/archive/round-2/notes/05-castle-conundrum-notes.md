# Castle Conundrum — session notes

## What changed

### Task one: shrink what ships — 46.39 MB → 29.46 MB over 117 → 116 requests

Two contained wins, both bigger than round 1's estimate.

**NPC models, `.gltf` → `.glb`.** `assets/NPCs/King.gltf`, `Adventurer.gltf`, `Farmer.gltf`
were self-contained `.gltf` with base64-embedded buffers, which inflates size by about a
third. Converted with `gltf-transform copy` (no geometry/animation/material change, just
re-packing the same accessors into a binary container):

| file | before | after |
| --- | --- | --- |
| King | 3.79 MB | 2.07 MB |
| Adventurer | 3.67 MB | 1.98 MB |
| Farmer | 3.00 MB | 1.48 MB |

Total 10.46 MB → 5.53 MB, saved 4.93 MB — about double round 1's ~2.5 MB estimate.
`data/npcs.json`'s three `modelPath` entries now point at the `.glb` files; the old
`.gltf` files are deleted. `npc.js`'s `loadGLTF` path is generic (locked #15's spirit:
nothing keys off a model's extension any more than it keys off an NPC id), so no code
changed.

**Four Poly Haven prop kits, 1k textures → 512.** `brass_candleholders_1k`,
`gothic_statue_1k`, `ornate_medieval_mace_1k`, `wooden_gate_1k` — all four run about a
dozen 1024px diffuse/normal/ARM maps for props that read as a few dozen pixels on
screen or (wooden_gate, see "Deliberately not done") aren't currently visible at all.
Resized with `gltf-transform resize --width 512 --height 512` (Lanczos3), which
rewrites each folder's `.gltf` + `.bin` + `textures/` as a unit — verified byte-for-byte
identical file names before swapping, and confirmed the extension list
(`KHR_materials_ior`, `KHR_materials_specular`) survived the round-trip:

| folder | before | after |
| --- | --- | --- |
| brass_candleholders_1k.gltf | 9.2 MB | 2.0 MB |
| gothic_statue_1k.gltf | 3.9 MB | 1.3 MB |
| ornate_medieval_mace_1k.gltf | 2.7 MB | 648 KB |
| wooden_gate_1k.gltf | 4.2 MB | 2.5 MB |

**Measured the visual cost at 512 before committing (locked decision #42).**
Before/after pairs, same camera, same session — `Claude Prompts/notes/05-castle-conundrum/texture-512/`:
- `scholar-{before,after}.png` — the candleholders and lantern on the hall table, the
  closest a player gets to them. No visible difference.
- `guard-{before,after}.png` / `gate-{before,after}.png` — the mace in the Guard's hand,
  a few dozen pixels at interact range. No visible difference.
- `wooden_gate`: never appears in-frame in any normal playthrough screenshot (see
  "Deliberately not done" — the door pivot sits outside the archway it's meant to fill,
  a pre-existing issue unrelated to this change), so there's no in-game before/after
  for it. Textures confirmed 1024→512 via `sharp` metadata; the risk here is lower
  than the other three specifically because nothing currently renders it up close.

Full-suite ship weight, measured the same way round 1 did (a probe that intercepts
every request the dev server answers and stats the file on disk, since chunked
responses have no `content-length`): **29.46 MB over 116 requests**, down from
46.39 MB over 117. `assets/` on disk is still ~166 MB (NPCs and four prop kits got
smaller; nothing else changed), so the dead-weight-in-a-clone story is basically
unchanged, just applied to a smaller total.

### Task two: rebuilt the interior hall at the kit's real module scale

`normalizeToTile()` in `castle-builder.js` computed its scale factor from a piece's
own X size (`this.tile / size.x`). That's right for every piece in the kit except
`wall-half.glb`: it's the one module that's deliberately *not* 1 unit in X (it's a
half-width piece, X = 0.5), so deriving the scale from X gave it 8x instead of 4x —
correct width (4m, because the run's spacing math depended on that), but 8m tall and
8m deep, double every other wall's height and depth and half its vertical texel
density.

Every piece in this kit — `wall.glb`, `wall-half.glb`, `wall-low.glb`, `tower.glb`,
`wall-fortified-gate.glb` — is 1 unit deep in Z, including the ones that are half
somewhere else (wall-half is half-*width*, wall-low is half-*height*). Z is the
dimension that's never the odd one out. Changed `normalizeToTile()` to scale off
`size.z` instead of `size.x`. This is a no-op for every model except wall-half.glb
(confirmed: wall.glb, wall-low.glb, tower.glb and the gate all have size.x = size.z = 1,
so old and new code give the identical scale factor). wall-half.glb now comes out
2m wide, 4m tall, 4m deep — correct proportions, matching every other wall.

That fixes proportions but breaks spacing: the wallRuns that place wall-half pieces
were built assuming each piece is 4m wide (the old, buggy width) at 4m (one-tile)
steps. A correctly-scaled 2m-wide piece at a 4m step leaves a 2m gap. Fixed by
halving the step and doubling the count on all four wall-half runs in
`data/scene-config.json` (`courtyard.wallRuns`): the two south-wall runs flanking the
doorway (step `[1,0]` count 2 → step `[0.5,0]` count 4 each) and the two single-piece
side-wall entries (step `[0,1]` count 1 → step `[0,0.5]` count 2 each). The two side
walls needed opposite step signs — `rotationY: 90` and `rotationY: 270` mirror which
world direction a positive Z-step tile-coordinate moves the piece, so the west run
steps `+0.5` and the east run steps `-0.5`; using the same sign on both (my first
attempt) put the east run's second piece back on top of the south partition instead
of extending to the outer wall. Caught by an automated dedup-and-adjacency check
against every wall-half piece's measured world box (12 pieces, checked for
continuity and non-overlap), not by eyeballing a screenshot.

Verified with a disposable Playwright probe (not `npm run play`, which doesn't frame
the hall from outside): overhead and doorway shots before/after, plus a full
collider-box dump. `Claude Prompts/notes/05-castle-conundrum/hall-rebuild/`:
`overhead-{before,after}.png`, `doorway-{before,after}.png`,
`inside-{before,after}.png`. The doorway goes from an 8m tunnel to a proportioned
4m-thick partition; the hall walls' texel density visibly matches the outer walls
instead of being twice the brick size.

**No repositioning needed.** The doorway's world x-gap (0..4, driven by
`wall-half.glb`'s off-centre local X range, unaffected by this fix) is unchanged, and
the Scholar (`[1.5, 0, -10.0]`), hall brazier (world `[3.4, -6.4]`), and hall
furniture are all positioned in absolute world coordinates that happened to still
clear the corrected geometry. `npm run play`'s existing Scholar-clearance and
brazier-placement beats pass unchanged, with zero position edits — better than
round 1's own note ("expect to re-place the Scholar and the hall brazier
afterward") anticipated. See "Deliberately not done" for what this investigation
found instead.

### Task three: `column.glb` given an explicit scale

`castle-builder.js` only called `normalizeToTile` for `tower`/`wall`-prefixed models;
`column.glb` (0.2 x 1 x 0.2 in model units) fell through to `groundAndCenter`, which
doesn't touch scale, so the two hall columns sat at native size: 1m tall, 20cm thick,
invisible in every screenshot. Neither branch was right — `normalizeToTile` would
have made them 20m tall (scaling a 0.2-unit dimension to a 4m tile is a 20x factor).

Added `normalizeHeight(obj)`, scaling uniformly so height matches `tileSize` (4m —
the same height every wall in the castle now correctly stands, after the fix above),
and a `p.model.startsWith('column')` branch in the placements loop. Both columns
(`column.glb` and `column-damaged.glb`) are now 4m tall, 80cm thick, and stand flush
against the hall's east/west interior walls — visible floor-to-ceiling supports
instead of ankle-high stubs. Screenshot: a column engaged at the hall's wall corner,
clearly readable as a support post.

### Task four: brazier colliders

`createBrazier()` in `scene-setup.js` took a bare `scene` and had no way to register
a collider; `castle.colliders` is built inside `CastleBuilder.build()`/`addCollider()`,
and the braziers are constructed separately from `main.js` after `castle.build()`
returns. Changed `createBrazier(scene, position)` to `createBrazier(castle, position)`
(reading `castle.scene` internally) and added `castle.addCollider(stand, 'brazier')`
right after the stand group is built. `main.js`'s one call site updated to pass
`castle` instead of `scene`. All three braziers (two at the gate, one in the hall)
now block movement; none of them are on the walked path to either NPC, so no
existing beat needed adjusting.

## What I verified

`cd Tools/board-check && npm run play` → **32 beats, all passing**, headed (up from 29 —
three new beats this round, all mine, all broken-on-purpose first per locked
decision #34):

```
  ok    reached the start screen  Summoning stonework… 144/144
  ok    three rigged NPC bodies in the scene  found 3
  ok    every skeleton rebound into the scene tree (SkeletonUtils clone)
  ok    rigs are animating  3 hand bones tracked
  ok    every pixel-art texture magnifies NEAREST  25 textures at <=128px
  ok    the 1k Poly Haven maps still magnify LINEAR  52 textures over 128px
  ok    every texture is at the GPU anisotropy ceiling  cap 16, worst 16, 77 textures
  ok    interior hall walls are the same height as the outer walls  outer 4m, hall 4m
  ok    hall columns reach the same height as the walls, not a 1m stub  4m across 4 submeshes
  ok    every tabletop item rests on the table, not above it  2 items, gaps -0.001/-0.001
  ok    no tabletop item overhangs the table  worst overhang 0m
  ok    the Scholar is standing clear of the hall table  0.286m clear
  ok    every brazier has a stand that reaches the floor  coal@0.9 base@-0.001 6parts (x3)
  ok    no brazier is sealed inside the stonework  [-3.2,9.4] [3.2,9.4] [3.4,-6.4]
  ok    pointer lock engaged
  ok    the hall brazier collider stops the player walking into it  blocked as expected
  ...the 17 pre-existing quest beats, unchanged...
  ok    no page/console errors
  ok    no offsite requests
```

### Every new beat broken on purpose first (locked decision #34)

| What I broke | What failed |
| --- | --- |
| reverted `normalizeToTile` to scale off `size.x` | `interior hall walls are the same height as the outer walls` — `outer 4m, hall 8m` |
| reverted the `column` branch to fall through to `groundAndCenter` | `hall columns reach the same height as the walls, not a 1m stub` — `1m across 4 submeshes` |
| commented out `castle.addCollider(stand, 'brazier')` | `the hall brazier collider stops the player walking into it` — `reached 0.23m — no collider` |

One more thing worth recording about the brazier beat: my first version used
`maxBursts: 6`, which passed even with the collider removed — not because the
collider was working, but because 6 bursts isn't enough to reach the brazier at all
regardless of collision, so "never arrived" was a false pass. Confirmed with a
standalone script: without a collider, `walkTo` reaches within 0.23m by burst 11;
with one, it's still 0.74m away after 25. Raised `maxBursts` to 20, which discriminates
correctly in both directions. A beat that can't fail isn't a beat.

Reverted all three and confirmed a clean 32-beat run. `grep -rn "REINTRODUCED"` over
`Projects/Castle Conundrum` and `play-castle.mjs` returns nothing.

### Ship-weight audit

Same method as round 1: a Playwright probe that intercepts every request the dev
server answers and stats the matching file on disk (chunked responses carry no
`content-length`). **29.46 MB over 116 requests**, down from 46.39 MB over 117.
Worst offenders now:

```
2312 KB  Poly Haven/wooden_gate_1k.gltf/wooden_gate.bin       (mesh data, untouched by resize)
2020 KB  assets/NPCs/King.glb
1931 KB  assets/NPCs/Adventurer.glb
1442 KB  assets/NPCs/Farmer.glb
1274 KB  libs/three.module.js
1161 KB  Poly Haven/brass_candleholders_1k.gltf/brass_candleholders.bin
 891 KB  Poly Haven/gothic_statue_1k.gltf/gothic_statue.bin
```

`npm run check` and `npm run social:check`: ran both for completeness. Both report
pre-existing failures **unrelated to this project** — `check-integrity.mjs` flags
`newindex.html` hotlinking Google Fonts, and `social:check` can't parse `index.html`'s
notice markup. Neither file is in this project's ownership (`index.html` and
anything site-wide belongs to prompt 21), and `git status` shows other projects
(`Pathfinder/Anathema_Archive.html`, `Projects/aphelion/**`) mid-edit from other
threads working the same repo right now, consistent with the README's twenty-one-way
split. Not touched, not mine to fix — flagging in case prompt 21 wants it, but this
is not a Castle Conundrum regression.

`npm run check` (collisions half specifically, run standalone since integrity's
non-zero exit short-circuits the `&&`): **0 collisions, tightest vertical gap
9.2px** across nine widths — unaffected by anything in this project, as expected.

### Verified in headed Chrome, not the pane

Per locked decision #25, everything above ran through `playwright-core` against
real Chrome — both `npm run play` and every disposable probe script I wrote this
session for the hall/column/statue/ship-weight measurements. A hook this session
offered to start a dev server for the in-app Browser pane; not used, for the same
reason as every previous round: the pane doesn't composite WebGL when hidden.

## Shared-file requests

**Re-capture and re-promote Castle Conundrum's preview and OG card, again.** Round
1 already flagged this (walls/braziers fixed, cards not re-shot) and I don't see
evidence it happened yet — `assets/previews/castle-conundrum.jpg` and
`assets/og/castle-conundrum.jpg` are outside this project's ownership so I only
read, didn't check timestamps against a promote run. Either way, this round adds
more reasons the promoted card is stale: no columns visible before, and the hall
now reads as a proportioned room instead of a stretched one if the capture frame
happens to catch it. Recipe unchanged from round 1's request:

```
cd Tools/board-check
npm run previews          # then look at candidates/
# name the new castle-conundrum frame in candidates/chosen.json
npm run promote
```

Nothing in `games.mjs` needs changing — its `castle-conundrum` recipe (URL, frame
size, three.js specifier, intro overlays, `open()` steps) isn't affected by
anything this round touched.

## Deliberately not done

**The hall table and the gothic statue are both embedded in the back wall — found
this round, not caused by it, and not fixed.** While verifying the hall geometry
fix, I measured furniture against the outer north wall's actual position (tile
`z = -3`, wall.glb, world `z` range `[-14, -10]` — never touched by anything in this
session, so this predates round 1 too):

- `gothic_statue` (tile `[0, -2.85]`): world box `z [-11.77, -10.21]`. Both numbers
  are more negative than -10, so the *entire* statue sits inside the wall's
  `[-14, -10]` volume. Confirmed with a direct camera probe standing where the
  statue should be visible: nothing renders there. It's not clipping, it's fully
  hidden — a decorative prop that's been invisible for at least two rounds and
  nothing catches it, because no existing check measures furniture against the
  wall behind it (only against the table, and against the floor for the braziers).
- `WoodenTable_01` (tile `[0, -2.5]`, the hall table every other beat is keyed off
  `HALL_TABLE` in `play-castle.mjs`): world box `z [-10.33, -9.67]`. Its own north
  edge is 0.33m past the wall's south face at `z = -10`.

I didn't fix this. Both the table and the statue are part of a tightly-packed
furniture cluster (table, chair, statue, candleholders, lantern, the Scholar
himself standing at `z = -10.0`, right at the wall face) that spans about 3m of the
room's 4m of usable depth (`z -10` to `z -6`, the doorway partition's inner face).
Shifting the cluster south to clear the wall is possible in principle — the whole
group's span (3.01m, statue's north edge to the chair's south edge) fits inside the
4m room if moved — but it means re-tuning six positions together (table, chair,
statue, candleholders, lantern tile coordinates, the Scholar's own position, and
`SCHOLAR` in `play-castle.mjs`), the same scope of work round 1 did once already for
just the Scholar. That's a session of its own, not something to bolt onto this
one's task list. Numbers above are exact enough to act on directly next time.

**Re-materialling the walls with Poly Haven stone. Still decided, not open work** —
unchanged from round 1's call, restated here only because this round touched the
same walls' scale and someone reading just this file shouldn't have to go dig up
round 1's reasoning. See `Claude Prompts/notes/05-castle-conundrum/` (round 1's
pairs) if it needs re-litigating.

**wooden_gate's door leaf doesn't visibly block the archway.** Discovered while
trying to get an in-frame before/after for its texture downsample (see "What I
verified"). `castle-builder.js`'s gate-door pivot math places the "closed" door at
world `x` roughly `[-5.4, -1.8]` — off to the side of the courtyard's centered
archway opening (`x` centered on 0), not across it. I didn't trace whether this is
a sign error in the hinge rotation math, a `rotationY: 180` config value that means
something other than what it looks like it should, or was never actually correct.
Given it's the reason I couldn't get a clean in-frame texture comparison for one of
this round's four downsampled props, and given the door leaf apparently never
visibly blocks anything regardless of quest state, this reads as a pre-existing
bug, independent of the texture change (confirmed: the door's position config
and the pivot math are both untouched by this session). Not investigated further —
it's not on this round's task list and the archway visually reads fine without it
(you just never see a door swing, open or closed). Worth a session if someone wants
the gate to actually look like it opens rather than just reporting that it did.

**Brazier collider radius.** Didn't tune it. `addCollider` takes the brazier
stand's full bounding box (legs + bowl + coals, roughly 0.6m across), which is
generous compared to the visual footprint but keeps players from walking directly
onto the flame, which was the actual goal. Not touched further.

## Next session

Ordered by value per effort.

1. **Fix the table/statue wall embedding** (Deliberately-not-done, above). Highest
   value of anything left — a whole decorative prop is currently invisible, and the
   hall table itself clips 0.33m into solid stone. Exact numbers are above; this is
   a furniture re-tuning session like round 1's Scholar work, not a quick edit.
2. **Re-capture and re-promote the preview/OG card** (shared-file request above).
   Third round this has been flagged; still cheap, still stale.
3. **The gate door's hinge/pivot placement** (Deliberately-not-done, above). Not
   urgent — the archway looks fine without it — but "the gate visibly opens" is
   part of what the quest text promises and currently doesn't happen.
4. Everything else from round 1's list that isn't re-litigated above (walls
   stylised, texture duplication, no save) still stands; see round 1's own notes
   under `Claude Prompts/archive/round-1/notes/05-castle-conundrum-notes.md` if
   those need re-deriving.
