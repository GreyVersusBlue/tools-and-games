# Castle Conundrum — session notes

## What changed

### The blurry walls were a sampling bug, not a resolution or a UV bug

v6 §8 diagnosed this as "Poly Haven kit models at 1k textures, scaled to 4 m tiles
by `castle-builder.js`, and scaling a mesh stretches its UVs — so the texture is
magnified, which no amount of anisotropy fixes." Both halves of that are wrong, and
the conclusion it led to (source 2k textures or re-tile UVs, either way a session of
geometry work) was wrong with it.

The walls are not Poly Haven. `scene-config.json`'s `wallRuns` and the gate arch all
come from `kenneyBase`, the Kenney retro-fantasy kit: `wall.glb`, `wall-half.glb`,
`tower.glb`, `wall-fortified-gate.glb`. Their textures are ten PNGs in
`Models/GLB format/Textures/`, **every one of them 64x64**, 72 KB for the whole set.
Deliberate pixel art, not a low-res mistake.

And their glTF samplers say exactly this:

```json
"samplers": [{"minFilter": 9987}]
```

`minFilter` and no `magFilter`. `libs/addons/loaders/GLTFLoader.js:3229` reads that as
`texture.magFilter = WEBGL_FILTERS[sampler.magFilter] || LinearFilter`. So a 64 px
cobblestone was being **bilinearly interpolated** across a 4 m wall. That is the
smear. There is no extra detail in a 64 px pixel-art tile for a bigger source file to
recover, so buying 2k textures would have fixed nothing about the interpolation and
`anisotropy` was never going to touch it either — anisotropy corrects grazing angles,
not magnification.

Measured texel density, from the accessors rather than by eye. `wall.glb` is a 1x1x1
module scaled 4x, with UVs spanning 4 u-units over its 4 m width and 2 v-units over
its 4 m height: **64 texels/m across, 32 up**. `wall-half.glb` comes out at 56 and
**16** (see the double-scaling note below). For comparison, a 1200 px viewport at 72°
FOV standing 2.5 m from a wall wants something over 300.

Separately, and this one applies to the whole game: **every texture in the scene had
`anisotropy = 1` against a GPU ceiling of 16.** Including the 1024 px `stone_pavers`
ground plane, which is a 140 m square seen almost edge-on for the entire game and was
the second most obviously mushy surface after the walls.

The fix is in `src/assets.js` and costs nothing:

- `setTextureQuality(renderer)` reads `renderer.capabilities.getMaxAnisotropy()` once.
- `tuneTexture(tex)` gives every texture that ceiling, and switches `magFilter` to
  `NearestFilter` for anything 128 px or smaller. `minFilter` is left at
  `LinearMipmapLinearFilter`; NEAREST-mag with trilinear-min is the standard
  pixel-art-in-3D pairing, and going nearest on both makes distant walls shimmer.
- `tuneMaterials(root)` walks the materials and runs once per file, inside
  `loadGLTF`'s success callback on the cached original. `SkeletonUtils.clone()` shares
  materials by reference, so every clone handed out afterwards is already tuned.
- `loadPBRMaterial`'s `tryTex` calls `tuneTexture` too. That is what fixes the ground.

**Size is the only discriminator.** Nothing consults a path, a material name or an
asset kit, so locked decision #15's spirit holds. It is also self-limiting by
accident of what is on disk: the Poly Haven maps are all 1024 px, and the three
Quaternius NPCs carry `"images": []` — flat colour materials, no textures at all — so
the pixel-art branch can only ever reach the retro kit. The suite confirms the split
at 25 textures at or under 128 px and 52 over it.

`src/scene-setup.js` calls `setTextureQuality` immediately after constructing the
renderer, before the ground plane it builds ten lines later and before
`castle-builder` loads anything. Ordering matters here: textures are tuned as they
arrive, so anything that loads first keeps the defaults.

Before/after pairs, same camera, same session, sampling toggled at runtime so the
render is the only variable:

- `Claude Prompts/notes/05-castle-conundrum/hall-wall-{before,after}.png` — 2.5 m from
  the hall wall, the frame v6 §8 pointed at. This is where it is dramatic.
- `Claude Prompts/notes/05-castle-conundrum/gate-wall-{before,after}.png` — the Guard's
  post, plus the new brazier.
- `Claude Prompts/notes/05-castle-conundrum/courtyard-{before,after}.png` — 6+ m, the
  distance the previews were framed at. The wall difference is real but small here,
  and the ground pavers are the obvious change. v6's "the previews are framed from
  6+ m where it does not show" was an accurate read of its own screenshots.

### The Scholar was 0.57 m inside the hall table

Measured, not eyeballed: the table's world box is x -0.9..0.9, z -10.33..-9.67, and
it is **0.55 m tall**. His body box at `[0.8, 0, -9.6]` was x 0.33..1.08, z
-10.08..-9.3, so 0.57 m of him was in it in x.

First attempt was `[1.45, 0, -10.85]`, standing him behind the table so the player
talks to him across it. Better staging and it does not work: the hall doorway is a
4 m wide, 8 m deep tunnel, and `walkTo`'s strafe nudge wedged the player against its
wall before ever getting in range. The run aborted at `walked to the Scholar — never
got in range` with a screenshot of stone filling the frame. Reverted.

Shipped `[1.5, 0, -10.0]`: 0.6 m east of the table's east edge, and 0.28 m clear of
the 0.18 m stool at (2, -9.2), which two of my earlier candidates clipped. The suite
reports 0.286 m clear. `facing` went 200 → 346 so he watches the doorway he is
approached from; he used to have his back to the arriving player, which is the same
thing v5 fixed on the Guard.

`SCHOLAR` in `play-castle.mjs` moved to match, and `npcs.json` carries a `comment`
saying so.

### The braziers had no body, and all three were standing inside stone

`createBrazier` built a 0.12 m `SphereGeometry` with an emissive material, put it at
y = 1.3 next to a `PointLight`, and stopped. Nothing held it up. That is the whole of
the "floating / unsupported" item.

Rebuilt from primitives in `scene-setup.js`: three splayed legs, a brace ring, a
flared open bowl, a base disc, and coals sunk into the bowl so the glow comes from
inside it. Bowl rim at 1.06 m, light at 1.26 m, which is 4 cm from where the light
already was, so courtyard lighting is unchanged and the before/after is honest.
Primitives rather than a model because the Kenney kit has no brazier and pulling in a
Poly Haven vessel would turn a synchronous call into an async one for three objects
the player never gets within 2 m of.

Then the new placement beat found the actual problem. **All three bowls were inside
wall boxes.** The gate braziers sat at world (±3.2, 10.8); the south wall pieces span
z 10..14 and x -14..-2 and 2..14, so both were buried in 4 m of rock. The hall one at
(0, -6.4) was flush inside the doorway's west jamb.

Nobody caught this in six sessions because **a `PointLight` is not occluded by
geometry in this renderer.** All three lit the courtyard and the doorway exactly as
intended from inside solid stone. This is v5 decision 26 applied to scenery instead of
to an NPC: the light looking right proves nothing about where the object is, the same
way the interact prompt appearing proved nothing about where the Guard was.

My first nudge made it worse. I moved the hall brazier west to x = -1.6 on the
assumption that the doorway gap was x -2..2, and the beat reported it `IN wall-half`.
The gap is **x 0..4**. `wall-half.glb`'s local x range is 0..0.5 rather than centred,
and `normalizeToTile` re-grounds y but never re-centres x or z, so a piece placed on
tile n covers world x 4n..4n+4. The config comment claiming "gap at x=0 is the
doorway" is now corrected in place.

Shipped: gate braziers at tile z 2.35 (world 9.4), 0.31 m clear of the wall's inner
face and out in the courtyard where they are visible. Hall brazier at tile x 0.85
(world 3.4), against the east jamb and 1.1 m off the line the player walks to reach
the Scholar.

No colliders on them. The bare coal had none either so this is not a regression, but
see below.

### The candelabra were floating, which was not on the backlog

Not one of the three known items, but it is the same defect class and it is the most
visible thing in `shots/play/01-at-scholar.png` after the wall itself. The lantern and
the brass candleholders carried `"yOffset": 0.95` next to a comment reading "yOffset
is a table-height guess, tune after first load". Nobody tuned it, and the table is
0.55 m, so they hung 0.40 m in the air.

Rather than typing in 0.55, `castle-builder.js` now measures. `surfaceHeightUnder()`
finds the highest already-placed surface an interior prop is standing over, and
`yOffset` became a lift **above** that rather than an absolute height. Props are
placed in config order so each can stand on any earlier one, and the kite shield —
which has nothing underneath it — keeps its 1.2 and keeps meaning what it says.

Two things about that function are load-bearing and both cost me a run:

- Overlap is a real 2D rectangle test, not a centre-point test, because
  `brass_candleholders` is a 1.08 m spread of three separate candlesticks and a
  centre hit says nothing about whether the outer two have anything under them.
- Bare overlap is not enough either, and I shipped that version once. The gothic
  statue stands on the floor 1.4 m behind the table and its 1.56 m footprint clips
  the table's by 0.12 m, so any-overlap stood the **statue** on the table; the statue
  then became a 2.29 m surface that the candleholders clipped by 4 cm, and they went
  on top of *that*. The run reported a candleholder gap of 1.739 m, which is the
  statue's height. `SURFACE_COVERAGE = 0.5` requires a surface to be under most of an
  object before it counts as holding it up.

The collide rule changed from `if (!p.yOffset)` to `if (!p.noCollide)`, because a
tabletop item now wants no `yOffset` at all and 0 is falsy. `noCollide` is the
vocabulary `placements` already uses for the gate arch.

The candleholders also overhung the table's west end by 0.35 m, which the float was
hiding. Tile x -0.2 → -0.1 puts the whole spread on it.

### play-castle.mjs: 22 beats → 29

Seven new ones, all mine, all verified in both directions below.

## What I verified

`cd Tools/board-check && npm run play` → **29 beats, all passing**, headed. Full run:

```
  ok    reached the start screen  Summoning stonework… 147/147
  ok    three rigged NPC bodies in the scene  found 3
  ok    every skeleton rebound into the scene tree (SkeletonUtils clone)
  ok    rigs are animating  3 hand bones tracked
  ok    every pixel-art texture magnifies NEAREST  25 textures at <=128px
  ok    the 1k Poly Haven maps still magnify LINEAR  52 textures over 128px
  ok    every texture is at the GPU anisotropy ceiling  cap 16, worst 16, 77 textures
  ok    every tabletop item rests on the table, not above it  2 items, gaps -0.001/-0.001
  ok    no tabletop item overhangs the table  worst overhang 0m
  ok    the Scholar is standing clear of the hall table  0.286m clear
  ok    every brazier has a stand that reaches the floor  coal@0.9 base@-0.001 6parts (x3)
  ok    no brazier is sealed inside the stonework  [-3.2,9.4] [3.2,9.4] [3.4,-6.4]
  ...the 17 pre-existing quest beats, unchanged...
  ok    no page/console errors
  ok    no offsite requests
```

`npm run check` → **243 units checked, 0 broken; 0 collisions, tightest vertical gap
7.1px** across nine widths. (243 not v7's 235 — other sessions have added files.)

`npm run social:check` → **23 notices, 23 already current, 0 out of date.**

### Every new beat broken on purpose first (locked decision #34)

Seven new beats, five deliberate breakages, each one run on its own:

| What I broke | What failed |
| --- | --- |
| commented out `setTextureQuality(renderer)` | only `every texture is at the GPU anisotropy ceiling` — `cap 16, worst 1`. The two NEAREST beats stayed green, which is the point of splitting them. |
| commented out the `NearestFilter` line, restored the other | only `every pixel-art texture magnifies NEAREST`. Anisotropy stayed at 16. |
| `yOffset: 0.4` back on the candleholders | `every tabletop item rests on the table` — `gaps -0.001/0.399` |
| candleholders back to tile x -0.2 | `no tabletop item overhangs the table` — `worst overhang 0.346m` |
| Scholar back to `[0.8, 0, -9.6]` | `the Scholar is standing clear of the hall table` — `0.216m INSIDE it` |
| stripped every non-coal mesh from the brazier group | `every brazier has a stand that reaches the floor` — `base@0.9 0parts` (x3) |

The buried-brazier beat did not need breaking on purpose: it failed on its first run
against the shipped scene, which is how the bug was found —
`[-3.2,10.8] IN wall [3.2,10.8] IN wall [-1.6,-6.4] IN wall-half`.

Reverted all five and confirmed a clean 29-beat run. `grep -rn "REINTRODUCED"` over
the project and `play-castle.mjs` returns nothing.

One caveat worth recording: the first `setTextureQuality` breakage run reported 3
failures, and re-running the identical broken state reported 1. The two extra were
walk flake. v7 §6 is the first thing to suspect and it was right — nothing else
changed between the runs.

### Verified in headed Chrome, not the pane

Per locked decision #25, all of the above ran through `playwright-core` against real
Chrome. A hook in this session offered to start a dev server for the in-app Browser
pane; I did not use it. The pane does not composite WebGL when hidden, so every
frame-dependent assertion here would hang rather than fail.

### Audit numbers

Measured with a scratchpad probe that stats each requested URL on disk, because the
dev server answers chunked with no `content-length`.

**What ships to a visitor: 46.39 MB over 117 requests.** `assets/` on disk is 179 MB,
of which 44.93 MB is actually requested — so 134 MB is dead weight in a clone and free
to a browser. Breakdown: Poly Haven 34.78 MB, NPC models 9.98 MB, three.js + addons
1425 KB, `src` + `data` 67 KB, and the entire Kenney kit that all the stonework comes
from is **181 KB**.

Worst offenders, all decoration:

```
3701 KB  assets/NPCs/King.gltf
3585 KB  assets/NPCs/Adventurer.gltf
2928 KB  assets/NPCs/Farmer.gltf
2312 KB  Poly Haven/wooden_gate_1k.gltf/wooden_gate.bin
1274 KB  libs/three.module.js
1161 KB  Poly Haven/brass_candleholders_1k.gltf/brass_candleholders.bin
1040 KB  Poly Haven/gothic_statue_1k.gltf/textures/gothic_statue_nor_gl_1k.jpg
```

The three NPC files are `.gltf` with embedded base64 buffers, which inflates them by
about a third; `.glb` would take roughly 2.5 MB off the total for three characters.
`brass_candleholders` costs about 4 MB in mesh plus textures for three candlesticks on
a table, and `gothic_statue` about 3 MB in textures alone. Those props hold a few dozen
pixels each.

**Frame cost is not a problem.** Median frame 6.9 ms, p95 7.6 ms at 1200x800: 175
meshes, 288,881 triangles, 118 unique geometries, 77 unique materials, 5 lights, 1
shadow caster, 0 instanced meshes. Instancing the wall runs would be tidy and would
buy nothing measurable. The download is the cost, not the render.

## Shared-file requests

**Re-capture and re-promote Castle Conundrum's preview and OG card.** The promoted
`assets/previews/castle-conundrum.jpg` and `assets/og/castle-conundrum.jpg` now show
something a visitor no longer sees: blurry walls, a mushy ground plane, and no
braziers in a courtyard that now has two standing either side of the gate. The recipe
in `capture-previews.mjs` needs no edit — it frames from the Guard's position, which
did not move, and both new braziers land in frame at that standoff. This is just:

```
cd Tools/board-check
npm run previews          # then look at candidates/
# name the new castle-conundrum frame in candidates/chosen.json
npm run promote
```

Nothing in `games.mjs` needs changing. Its `castle-conundrum` recipe is URL, frame
size, three.js specifier, intro overlays and an `open()` that clicks `#start-button`;
none of that is affected. Nothing in `gvb-save.js` either — see below.

## Deliberately not done

**Re-materialling the walls with Poly Haven stone.** The repo already carries five
1k castle-wall texture sets on disk and none of them are loaded:
`castle_wall_slates_1k` 2172 KB, `old_stone_wall_1k` 2576 KB, `stone_tile_wall_1k`
1596 KB, `castle_wall_varriation_1k` 1976 KB, `rock_wall_16_1k` 2308 KB. Putting one
on the Kenney geometry with a sane repeat would give roughly 500 texels/m instead of
32, plus a normal map so the stone catches the sun, and would cost about +2.1 MB on a
46.39 MB budget — 4.5%, and locked #42 says measure rather than assume, so: measured,
it is cheap.

I did not do it, and this is an art-direction call rather than a cost one. The
walls are about 80% of the visible surface area and the three characters carry no
textures at all — flat colour materials on low-poly Quaternius rigs. Kenney kit plus
flat-shaded characters is a coherent stylised look, and NEAREST magnification makes
the walls read as deliberate pixel art rather than as a mistake. Photoreal stone
would make the *characters* the thing that clashes, which is a bigger clash across
more of the frame than the current one, and the current one is confined to the
furniture. The before/after pairs are the evidence; if someone disagrees after
looking at them, one repeat value and one material swap is the whole change.

**`wall-half.glb` is scaled 8x, not 4x.** `normalizeToTile` scales by
`tileSize / size.x`, and `wall-half.glb` is a 0.5 x 1 x 1 module, so it comes out
**4 m wide, 8 m tall and 8 m deep**. Every interior hall wall is double height and
double depth, which is why the hall doorway is an 8 m tunnel and why the hall wall has
the worst texel density in the game at 16 texels/m vertically — half the outer walls'.
It is visible in `hall-wall-after.png`: those texels are twice the size of the ones in
`gate-wall-after.png`.

I left it because there is no contained fix. Scaling it 4x makes each piece 2 m wide
and leaves 2 m gaps between pieces the runs place 4 m apart. Substituting `wall.glb`
fixes the scale but changes the hall's depth from 8 m to 4 m and its west and east
walls from 8 m blocks to 4 m ones, which moves the doorway, the enclosure, the
collider list and the Scholar's sightlines together. That is a hall rebuild with real
re-verification, and it would want the brazier and Scholar positions redone after it.
Worth a session; not worth bolting onto this one. `wall-low.glb` is the kit's actual
half-*height* piece (1 x 0.5 x 1, normalises correctly to 4 x 2 x 4) if the original
intent was a lower interior wall, which the name `wall-half` suggests someone assumed.

**The hall columns are 1 m stubs.** `column.glb` is 0.2 x 1 x 0.2 in model units and
`castle-builder` only calls `normalizeToTile` for models whose name starts with
`tower` or `wall`, so the two "hall columns" are placed at native scale: 1 m tall,
20 cm thick. Normalising them would make them 20x, i.e. 20 m tall and 4 m thick, so
neither branch is right and they want an explicit scale. They are at x ±5.6 and out of
frame in every current screenshot, which is why nobody has noticed.

**The Poly Haven props arrive at wildly different authored scales.** The hall "table"
is 0.55 m tall, the "stool" beside it is 0.18 m, and the "chair" is 2.27 m. That is
why the surface snap had to measure rather than trust a number, and it is worth
knowing before anyone places another one of these.

**Brazier colliders.** They are physical objects now and the player can walk through
them. I did not add colliders because `castle.colliders` is built in
`castle-builder.build()` and the braziers are created separately from `main.js`, so
wiring it means changing how they are constructed, and a new collider in the hall
doorway is exactly the kind of thing that turns a passing walk assertion into a
wedged player — which it already did once this session. The hall brazier is against
the east jamb and 1.1 m off the walked line, so the risk is a player deliberately
walking into one.

**Saving.** The game has none: no `localStorage` write anywhere, no key, no save bar,
and `games.mjs`'s `castle-conundrum` recipe has no `saveKey` because there is nothing
to wipe. I looked at adopting `gvb-save.js` and left it, because the state worth
saving is one boolean (`hasKeystone`) and one more (`victory`), and the quest is about
fifteen minutes long. The honest version of this feature is not persistence, it is
more game to persist. If someone does adopt it: there is no existing key, so locked
#36 does not bind; nothing initial is randomised, so `defaults` need not be a factory;
and per v7 §9 the save bar should not live only on the start overlay.

**Texture duplication.** Ten distinct Kenney PNGs arrive as about 24 separate GPU
texture objects, because each GLB references its own copy of `cobblestone.png` and
`modelCache` keys on the model path. At 16 KB each that is under 400 KB of GPU memory
and it is not worth a dedupe layer.

## Next session

Ordered by value per effort.

1. **Re-capture the preview and OG card** (the shared-file request above). Small,
   and the promoted card currently misrepresents the game.
2. **Shrink what ships.** 46.39 MB for a fifteen-minute quest, and it is nearly all
   decoration. Two contained wins: convert the three NPC `.gltf` files to `.glb` to
   drop the base64 inflation (~2.5 MB, no visual change at all), and downsample the
   1k PBR sets on the small props — `brass_candleholders`, `gothic_statue`,
   `ornate_medieval_mace`, `wooden_gate` — to 512. Those four are roughly 12 MB
   between them for objects that never fill more than a few dozen pixels. Numbers are
   in the audit section; measure the visual cost at 512 before committing.
3. **Rebuild the interior hall at the kit's real module scale**, which is the
   `wall-half` item above. This is the last thing standing between the hall and the
   outer walls looking like the same building, and it also halves the hall's texel
   density problem by construction rather than by filtering. Budget a session and
   expect to re-place the Scholar and the hall brazier afterwards.
4. **Give `column.glb` an explicit scale** and put the two hall columns somewhere they
   can be seen. Cheap, and 1 m stubs are a defect whichever way the intent went.
5. **Brazier colliders**, if step 3 happens — it is the natural moment, since the
   collider list is getting rebuilt anyway.
6. **Leave the walls stylised** unless someone looks at the before/after pairs and
   disagrees. Written up above with the byte cost so the decision does not have to be
   re-derived a fourth time.
