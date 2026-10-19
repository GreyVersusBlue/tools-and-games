# School Generator: the roof over outlines with holes

**A design. Nothing in it is built.** Written 2026-10-18 at Devon's request of
that evening (23:35 ET), decision #995. A Selector hands its increments to
implementation workers, one per session, in the order of section 4. The
questions that are Devon's are in section 6, each with the default an
implementer takes until he answers.

Every figure below came from a scratch prototype run on huginn against the
shipped `js/skeleton.js` at f2afe57 (section 7 says what was run). The
prototype is not in the repo and is not the code to ship; it is the evidence
that the algorithm in section 2 does what it says on the shapes it says.

Contents: 1 what keeps rectangles today, 2 the algorithm, 3 the module
surface, 4 the increments, 5 left out on purpose, 6 questions for Devon,
7 how the numbers were checked.

## The idea in four sentences

A hipped roof over a curve already stands on the straight skeleton of the
rooms' own outline (#965, #967), and three kinds of building still fall back to
the 4ft rectangles: one with a courtyard or a room with a hole, one with a
notch whose sides meet head on, and one roofed `gable`. The first two are the
same missing piece. A skeleton whose wavefront can start from more than one
ring, and whose reflex vertex can run into an edge of *another* loop, roofs a
courtyard, and the same wavefront stopped at a time `d` and run outward is the
eave line, which closes a head-on notch. Gable is a different algorithm (a
weighted skeleton), comes last, and may not be worth building.

## 1. What keeps rectangles today, and why

Only a footprint that takes the skeleton path changes anything here. That path
is `skeletonRoofsOf(state, roof)` in `roof.js`, the one test `roofPlan`,
`roofCover`, the takeoff and the estimate all ask (#970). It asks
`curvedRoofs(floor, eaveY, pitch)`, which asks `curvedLoopsOf(floor)`, which is
`roofOutline(floor).loops` filtered by `hasCurve`. A footprint is refused, and
keeps `maskRects` and `blockRoof`, at the first of these that says no.

| Shape | Where it is refused | Why |
| --- | --- | --- |
| A room with a hole (`shape.rings.length > 1`) | `unionOf`, first line: `'a room has a hole in it'` | `straightSkeleton` and `triangulate` each take one ring |
| Rooms closed round a courtyard | `unionOf`: the chained loop has area `<= 0` (wound the other way), `'the rooms close round a courtyard'` | same: the court is a second ring, wound clockwise |
| A courtyard that meets the outside at one corner | `unionOf`: one loop passes through a corner twice (`at.has(e.kf)`), same sentence | `cleanPolygon` refuses a vertex touching another (the pinch test at its end), so even one weakly simple loop would not reach the skeleton |
| A notch whose sides meet head on (square notch, slot, dovetail) narrower than two eaves (3ft) | `eaveLine` returns null; `curvedRoofs` drops the loop | `eavePolygon`'s mitred line crosses itself; `eaveLine`'s step-out (#993) moves to the first edge that closes, and two sides meeting head on leave a zero-width spike, which `cleanPolygon` refuses |
| `gable` over a curve | `skeletonRoofsOf`: `r.style !== 'hip'` | a gable end is a face with no slope; the skeleton has no way to hold an edge still |

What a refusal means for each roof style today:

- **hip** and **gable**: the building's rectangles, each hipped or gabled on
  its own (`blockRoof`), `sideIsOuter` hanging an eave only where the mask
  ends. A rectilinear courtyard already reads right this way: the court's
  cells are empty, so `sideIsOuter` hangs an eave into it. The rectangles are
  wrong only over a curve, as a staircase of 4ft hips.
- **parapet**: `maskOutlines` gives the mask's boundary as loops, the
  court's loop among them, so a rectilinear courtyard already has an inner
  parapet. Over a curve with a court, `parapetOnChords` never sees the
  building (`curvedLoopsOf` dropped it), so the curve's parapet is stepped.
- **flat**: nothing above the wall top, with or without a court. Nothing in
  this design changes `flat`.

So the work is for **a curved building with a court or a hole in it**, and for
**a curved building with a head-on notch**. A rectilinear building with a
courtyard keeps its rectangles under every style, and its plan does not move
(section 6, question 1, asks whether it should).

The tests that pin today's refusals, which the increments below rewrite one at
a time, each in the increment that changes the answer:
`test/roof-curve.test.mjs` "a courtyard is refused, and says so", "a room with
a hole of its own is refused", "a notch narrower than two eaves closes up and
is refused", "a curve on a courtyard keeps the rectangles, the outline having
said why"; `test/roof-courtyard.test.mjs` "alone, the courtyard building is
refused exactly as before"; `test/roof-pinch.test.mjs` "a pinch still refuses
a room inside another, and a courtyard"; `test/roof-tightcurve.test.mjs` "a
notch whose sides meet head on is still refused".

## 2. The algorithm

### 2.1 The wavefront with holes

`straightSkeleton` is a wavefront over loops already: `loops` starts as one
loop and a split event turns one loop into two. A polygon with holes starts
with one loop per ring and needs exactly one event the shipped code does not
look for.

**Setup.** The outer ring is cleaned and wound counter-clockwise in (x, z), as
now. Each hole is cleaned the same way and then reversed, so it runs clockwise
and the building lies on the left of every edge of every ring, which is what
the existing `edges` table (inward left-hand normal) assumes. Corners are
numbered ring by ring, the outer ring first, so with no holes the numbering is
the one shipped. `next(i)` and `prev(i)` wrap within a corner's own ring, not
the whole list.

**Events.** Three kinds, the earliest processed each step:

1. **Edge event** (shipped): an edge's two vertices meet.
2. **Split event** (shipped): a reflex vertex runs into an edge of *its own*
   loop; the loop becomes two.
3. **Merge event** (new): a reflex vertex runs into an edge of *another*
   loop; the two loops become one. This is how a court's wavefront joins the
   outer one. A rectangular court's four corners are reflex from the
   building's side, and for a centred court in a square ring every one of them
   reaches the outer loop's edges at once.

The candidate test for a merge is the shipped split test with the target loop
widened: for reflex vertex `a` in loop `li`, every edge `p -> q` of every loop
`lj`, with the own-loop neighbour exclusions applying only when `lj === li`.
**Merge candidates are looked for only when the input has a hole or a pinch.**
A polygon with no holes still splits into several loops, and in exact
arithmetic two loops a split made never meet again; but a candidate found
between them by rounding would be a new event in a shipped roof, so with no
holes the search is the shipped one, line for line. The landing check (the hit point `s` within the edge's span as it will be at
`dt`) is unchanged.

**The merge.** Vertex `v` of loop A (index `i`, length `L`) hits edge
`p -> q` of loop B (index `j`, length `M`), whose edge is `eE`. The new loop
is

```
[ v1(eL = v.eL, eR = eE),  q, ..., p   (all M of B, from j+1 round to j),
  v2(eL = eE,  eR = v.eR), next(v), ..., prev(v)   (the other L-1 of A) ]
```

`v1` and `v2` start from the same retired node, as a split's two vertices do.
Both A and B are removed from `loops` and the merged loop is appended at the
end (section 2.4 says why the position matters).

**Settle, faces and the rest** are unchanged: `settle()` already works loop by
loop, a loop with no area is laid down as ridge, and the faces are walked
from each eave edge taking the sharpest left turn. The only change in the
face walk is that the eave edges include each hole's edges, linked by the
ring-local `next(i)`.

**Measured** (prototype, section 7): a 40ft square with a centred 20ft court
gives 8 faces, rise 5ft, plan area 1200 ft² (3 splits and 1 merge); off centre (court x 6 to 18, z 10 to 30) rise 11ft, 1360 ft²; the
courtyard building of `test/roof-courtyard.test.mjs` (40 by 40 with a 24 by
24 court) rise 4ft, 1024 ft²; a 40 by 32 hall with a 16-chord semicircular end
and a 12 by 8 court, 23 faces, rise 16ft; the same hall with two courts, 27
faces; with a round court of 12 chords, 31 faces. In every case each face's
nodes lie on its own plane to 1e-13 ft and the faces' plan areas add up to the
outer ring less the holes exactly (to 4 decimals of ft²). Under 7ms each once warm (the first run,
JIT and all, took 18ms).

### 2.2 The eave, out from the outer ring and into each court

A pitched roof over a court overhangs the court: the court's eave is the hole
ring pushed `EAVE` (1.5ft) into the court, and the roof stands on the outer
eave with the court eaves as its holes. That is the wavefront at time `-EAVE`,
the same property `eavePolygon`'s header names for the outer ring.

Both offsets are one operation, **the wavefront stopped at a time**. For a
ring offset inward by `d`, run the wavefront of the ring as an outer polygon
and stop at `now = d`, returning the loops as they stand (zero, one or more).
For a ring offset outward by `d`, run it as a *hole* inside a frame (a
rectangle round the ring's bounds with a margin of `4d + 10` ft, so the frame's
loop cannot meet the ring's before `d`) and return the loops that are not the
frame's. A court's eave is the court ring (as drawn, counter-clockwise)
offset inward by `EAVE`. The outer eave is the outer ring offset outward.

What this buys over `eavePolygon` and `eaveLine` is the head-on notch. Two
sides of a notch facing each other walk towards each other as the eave moves
out, meet at half the notch's width, and the region between them has no area
left: `settle()` lays it down as a line and retires it, which is the shipped
code's ordinary handling of two parallel sides meeting along a ridge. The
eave runs straight past where the notch was.

**Measured**: a 40 by 24 block with a 3ft deep notch in its west wall, eave
1.5ft. 2ft wide, the notch closes at t = 1 and the eave is the plain rectangle
(-1.5, -1.5) to (41.5, 25.5), plus one straight-through corner at (-1.5, 12)
that `cleanPolygon` drops. 3ft wide, it closes at exactly t = 1.5, the
eave's own distance, with the same answer: a simultaneous event at the stop
time is processed, not stopped short of. 4ft wide, it stays open 1ft wide,
which is what `eavePolygon`'s mitred line already gives, point for point.

**How `eaveLine` changes.** It keeps its first two answers, in order: the
mitred line if `eavePolygon` accepts it, then #993's step-out. Only where both
return null does it ask `offsetRing(loop, -d)`; one loop back is the eave, and
anything else (none, or two pieces) is still null. So every loop that has an
eave today has the same eave, and the shipped hashes cannot move by this
route (section 2.4).

**A court whose eave closes.** A court narrower than two eaves (3ft) has no
eave at 1.5ft: `offsetRing(court, 1.5)` gives no loop. A court the eave pinches
into two gives two loops. The default is to refuse the building (rectangles)
in the first case and to take both loops as holes in the second; whether a
light well should be roofed over instead is question 3.

### 2.3 Degenerate cases

| Case | What happens | Where |
| --- | --- | --- |
| Parallel edges meeting head on (a wing's two sides, a notch's two sides) | the loop between has no area; `settle()` lays it down as ridge, as shipped | `settle` |
| Anti-parallel neighbours (a zero-width spike) | `vertexOrSpike` holds the point still, as shipped | `vertexOrSpike` |
| Simultaneous events (a square court's four corners reach the outer loop at one moment) | events within `EPS` of the earliest: the first found is processed, everything moves to that time, and the next ones come at `dt = 0` in the following passes; `settle()` merges coincident neighbours after each | event loop |
| A merge and a split at one time | the same: one per pass, in search order | event loop |
| Collinear corners | `cleanPolygon` drops them before anything runs (sine under `1e-6`), per ring | `cleanPolygon` |
| A hole crossing the outer ring or another hole | refused: `null` | new `cleanRings` |
| A hole touching the outer ring or another hole at a point, given as separate rings | **refused**. The prototype run on a court touching the outer edge at its midpoint ran to the end and gave faces 20ft off their own planes (section 7). The touch is only handled as one weakly simple ring (next row) | new `cleanRings` |
| A courtyard meeting the outside at a single corner | one ring through that corner twice (a weakly simple polygon), which `unionOf` already chains. `cleanPolygon` gains a `pinch` option that allows a corner to repeat (the same point twice, never a corner on an edge) where the two wedges at it do not overlap. The two visits are two corners with their own bisectors, and they move apart from t = 0. Measured: an L of 40ft arms whose 10ft court touches the L's inner corner, one loop through (20, 20) twice: 10 faces, rise 10ft, area 1100 ft², every face on its plane to 0 | `cleanPolygon({ pinch })`, `unionOf` |
| A court whose eave closes or splits | section 2.2 | `offsetRing` |
| A hole's own head-on notch, a curve bowed into the court | the court's inward offset handles both the same way as the outer ring's outward one | `offsetRing` |

**The gate.** The touch case above is the reason the skeleton checks its own
answer before returning it. `straightSkeleton` gets a last step,
`skeletonHolds(sk)`: every face's nodes lie on the plane through its eave edge
at height `t` (each node's `t` is its distance from that edge's line, within
`1e-6 * scale`), and the faces' plan areas add up to the outer ring less the
holes within `1e-9 * scale²`. If either fails it returns null, the caller
keeps the rectangles, and a quietly wrong roof cannot reach the renderer. The
existing tests check the plane property from outside on every shape; this
makes it a precondition of the return value. Cost: one pass over the nodes.

**Tolerances, in feet.** No new constants. `cleanPolygon`'s `eps` stays
`scale * 1e-9` and the skeleton's `EPS` stays `scale * 1e-7` (a 200ft
building: 2e-5ft), with `scale` taken over the outer ring's bounds, which
contain every hole. `OUTLINE_ON` stays `1e-4` ft in `roofOutline`: a court
corner within it of an outer wall is a touch and comes through as the pinch,
never as two rings. The gate's `1e-6 * scale` is 0.0002ft on that building.

### 2.4 Determinism, and why no shipped hash moves

The skeleton is deterministic now because the event search visits loops and
vertices in a fixed order and takes the first event within `EPS` of the
earliest. The rules that keep it so with holes:

- Rings are numbered outer first, holes in the order `roofOutline` gives
  them, which is the order of `shapesOf(floor)` and of each shape's `rings`.
- A split replaces its loop in place (`splice(li, 1, one, two)`), as shipped.
  A merge removes both loops and appends the merged one at the end. The
  ordering is a choice; what matters is that it never depends on anything but
  the input.
- No `Set` or `Map` iteration order decides an event. No randomness, no
  nudging.

Why the hashes stay: with no holes the event search is the shipped one (the
merge candidates are not looked for at all, 2.1), so the arithmetic is the
same operations in the same order. The gate (2.3) is the one new step on that
path: increment 1 runs it over every shape of every `skeleton*` and `roof-*`
test and the 108 cases, and if any shipped roof fails it, the gate applies to
inputs with holes or a pinch only and the failing shape is reported as a bug
found, not fixed in passing. The prototype's faces for the bowed hall and for an L were the shipped
module's, point for point and `t` for `t`, compared by `JSON.stringify`. And
every route into the new code is one the shipped code refuses: a hole, a
court, a pinch, or an eave both shipped eave functions refuse. No fixture,
the sample school or a gallery school has a room with a hole; any courtyard
among them is rectilinear and has no curve, so it never reaches the skeleton.

The 108-case hash of #990 to #994 (five fixtures, the sample school, the
three gallery schools; parapet, flat, gable, hip at pitch 2, 4 and 12; over
`roofPlan`, `roofHeightAt`, `computeElevation` and `computeSection`) is the
proof each increment runs, before and after, from a scratch script.

### 2.5 Later and separate: gable over a curve (a weighted skeleton)

A weighted straight skeleton gives each edge its own speed. An edge of weight
0 does not move: its face is vertical, which is a gable wall, and the slopes
either side meet it in the ridge's end. The velocity solve changes from
`v·nL = v·nR = 1` to `v·nL = wL, v·nR = wR`, and the edge and split times use
the edges' own speeds; the event structure is the one above.

What a gable over a curve would look like: the slopes run along the long
walls as now, and a **straight** end wall (a chord of zero curvature, square
to the ridge) takes weight 0 and stands as a gable; a curved end cannot be a
gable, and stays hipped, which is what an apse is. So a hall with one flat
end and one bowed end gets a gable and a half-cone. Which edges are gable
ends is a rule nobody has written down (question 5).

Whether it is worth it: probably not soon. Weight 0 next to weight 0 (two gable
ends at a corner) and weight 0 parallel to a ridge are degenerate in ways the
uniform skeleton is not, the gable triangle has to be built from the ridge's
end and the wall's top, and the plan's `gables` list has to come out of the
skeleton. It is two or three increments of its own, and the default (gable
over a curve keeps rectangles) is a building that reads as gabled already.

## 3. The module surface

Everything new goes in `skeleton.js` (pure, already loaded at boot) and
`roof.js`. **No module is added, so `BOOT_BUDGET` in `test/tools/run.mjs`
stays `{ bytes: 4 MB, requests: 116 }`, and the boot is 116 of 116.** If an
implementer finds `skeleton.js` past about 900 lines and wants a
`skeleton-holes.js`, that is a 117th request and `BOOT_BUDGET.requests` goes to
117 in the same commit, with the reason in its comment; the default is not to.

### 3.1 `skeleton.js`

| Function | Signature | Change |
| --- | --- | --- |
| `cleanPolygon` | `(input, { collinear = 1e-6, pinch = false } = {}) -> pts \| null` | new `pinch`: a corner may repeat once, where the two wedges at it do not overlap; a corner on an edge's interior is still refused. Default `false` gives the shipped answer for every input |
| `cleanRings` (new) | `(outer, holes, opts) -> { outer, holes } \| null` | `outer` through `cleanPolygon` (CCW), each hole through it and then reversed (CW); null where a hole is not inside the outer ring, where two rings cross, or where they come within `eps * 10` of each other anywhere |
| `straightSkeleton` | `(input, opts = {}) -> { poly, rings, nodes, arcs, faces } \| null` | `opts.holes` (list of rings) and `opts.pinch`. `poly` stays the outer ring, cleaned, for every caller that reads it; `rings` is `[outer, ...holesCW]`; `nodes` are corners ring by ring then the rest; `faces` one per edge of every ring, outer first, each `{ edge, ring, nodes }`. Merge event (2.1) and the gate (2.3) |
| `skeletonHolds` (new, exported for the tests) | `(sk) -> boolean` | the gate |
| `offsetRing` (new) | `(ring, d, { pinch } = {}) -> pts[][] \| null` | the wavefront of `ring` stopped at `|d|`: `d > 0` inward, `d < 0` outward through the frame; returns the loops, each CCW, possibly none; null where the ring is refused |
| `eavePolygon` | unchanged | still the mitred line; still the first answer `eaveLine` asks |
| `triangulate` | `(pts, holes = []) -> [i, j, k][] \| null` | with holes, each hole is bridged into the outer ring before ear clipping (holes taken by largest x first; bridge from the hole's rightmost corner to the nearest visible outer corner, the usual construction), and the indices are into `[...pts, ...holes.flat()]`. With `holes` empty, the shipped code runs unchanged |
| `roofHeightOver` | unchanged | it reads faces, and a face's first two points are still its eave |
| `skeletonRoof` | `(polygon, eaveY, pitch, { holes, pinch } = {}) -> { faces, gables, rise, topY, poly, holes }` | passes the holes through; faces of hole edges are ordinary slope faces, `edge` and `ring` set |

### 3.2 `roof.js`

| Function | Change |
| --- | --- |
| `roofOutline(floor)` | `{ loops, holes }`: `holes[i]` is the list of court rings inside `loops[i]` (empty where none). `unionOf` no longer refuses a room's own hole (its rings become holes of the loop that holds the room) or a loop wound the other way (it becomes a hole of the loop that contains it; one contained by none is still refused). A loop through a corner twice is kept as one loop with `pinch: true` set on its entry in a parallel `pinch` array, not refused. `refused` keeps every other sentence (overlap, does not close, crossing, a room inside another) |
| `hasCurve` | unchanged in itself; asked of every ring of a footprint |
| `curvedLoopsOf(floor)` | returns `[{ outer, holes, pinch }]` for every footprint with a curve on any ring (question 2). Its two callers in `roof.js` change with it |
| `eaveLine(loop, d)` | third answer `offsetRing(loop, -d)` (2.2) |
| `courtEaves` (new, private) | `(holes, d) -> pts[][] \| null`: each hole's `offsetRing(hole, d)`, flattened; null if any comes back empty (the default of question 3) |
| `curvedRoofs` | builds `skeletonRoof(eave, eaveY, pitch, { holes: courtEaves(holes, EAVE), pinch })`; each face's `tris` from `triangulate(f.pts)` as now (a skeleton face has no hole); the block carries `outline`, `holes`, `eave`, `eaveHoles` |
| `inFootprint` (new, exported) | `(block, x, z) -> boolean`: in `block.outline` and in none of `block.holes`. Every `pointInRing(c.outline, ...)` in `roofPlan`, `roofCover` and `elevation.js` becomes this |
| `parapetOnChords` | each taken footprint's parapet is its outer ring and every hole ring (the inner parapet); its deck is `{ pts, holes, tris }` with `tris` from `triangulate(pts, holes)` indexing `[...pts, ...holes.flat()]` |
| `chordPlan` | the `taken` polygons test `inFootprint`; `outlines` gains each taken hole ring, wound as `maskOutlines` winds a hole loop (covered side on the right), so `parapetRuns` needs no change |
| `ringMinus` | unchanged; a neighbour cut back to a curve with a court is cut against the outer ring only (a neighbour cannot reach into a court without crossing the curved building's walls) |
| `roofCover` | a footprint's area is `loopArea(outer) - sum(|loopArea(hole)|)`, and the mask cells given way are those `inFootprint` |
| `deckPolys` entries | gain `holes` (default `[]`); `pts` stays the outer ring for every reader |

### 3.3 Everything else

- **`render.js`** `buildRoofGroup`: a deck poly with holes is drawn by
  `roofFace([...pts, ...holes.flat()], '#ffffff', tris)`, one changed line;
  slope faces of a court are ordinary faces. No change to `roofFace`.
- **`elevation.js`** `roofHeightAt`: the two `pointInRing(b.outline, ...)`
  tests become `inFootprint(b, ...)`. Inside a court it then falls through to
  the mask, whose court cells are empty, and returns null: the section shows
  sky over the court, as it does for a rectilinear one now. `roofPaints`
  projects faces and needs nothing.
- **`takeoff.js`, `cost.js`**: nothing; they read `roofCover`.
- **`blueprint.js`**: nothing. Its site plan draws the ground storey's mask
  (left out on purpose, section 5).
- **`daylight.js`**: nothing. It already gives every window under a pitched
  roof an `EAVE` overhead; a court-facing window under the new court eave is
  that case.
- **`walk-template.html`**: carries `roof.js` and `skeleton.js`, so it is
  rebuilt in every increment that changes them.

## 4. Implementation increments

Each is one Opus worker, 60 to 90 minutes, and ships a passing state in which
the 108-case hash is the same before and after. Every new test is watched
failing on the code before it (#34), and each increment says which. Browser
checks run under the suites lock, one run per `flock`.

**1. The skeleton with holes, pure.** `skeleton.js`: `cleanRings`, holes in
`straightSkeleton` (ring-local `next`/`prev`, merge event, faces off every
ring), `skeletonHolds` as the last step. Nothing calls it with holes yet.
New `test/skeleton-holes.test.mjs`: (a) a 40ft square with a centred 20ft hole,
8 faces, rise 5, 1200 ft²; (b) off centre (x 6 to 18, z 10 to 30), rise 11,
1360 ft²; (c) 40 by 40 with a 24 by 24 court, rise 4, 1024 ft²; (d) the
16-chord bowed hall with one, two and a round court, every face on its plane
to 1e-9 and areas to the ring less the holes; (e) no holes: the bowed hall and
an L give exactly the faces they give today, pinned as a literal (compute it
before the change); (f) a hole crossing the outer ring, a hole outside it,
and a hole touching its edge at a point each give null. (a) to (d) fail on
the old code (the hole is ignored: the area is the outer ring's); (f)'s touch
case fails with the gate taken out (the faces come back 20ft off). Browser:
none. Leaves: `offsetRing`, `triangulate` with holes, the pinch, all wiring.

*Implementation note, 2026-10-19 (worker TG-28-holes1, #996).* Shipped as
written, with one finding. (f)'s touch case does **not** fail with the gate
taken out: with `cleanRings`'s touch check also removed, this skeleton roofs a
diamond court touching the square's edge at its middle correctly (8 faces,
every node on its plane to 0.000ft, 1500 ft² against 1500), and so do four
other touching courts tried. The prototype's 20ft error was the prototype's.
So the touch is refused by `cleanRings` alone, as section 2.3's table says,
and the gate is checked from outside on doctored skeletons (a node moved, a
node's time changed, a face dropped). No input is known that reaches the gate
and fails it: 2,451 seeded random rings with one to three courts, gate off,
all held. The wiring line (`skeletonHolds(sk) ? sk : null`) is therefore not
guarded by any failing input; the 108 cases and every `skeleton*`/`roof-*`
test pass through it, so the gate applies to every input, holes or not, as
2.4 allows. Searching merges with no hole too moved nothing (the 108-case
hash and the whole suite unchanged), so "only with holes" is a guard against
rounding nobody has seen, kept as designed. Increment 2 starts from here.

**2. The stopped wavefront and the bridged triangulation, pure.**
`skeleton.js`: `offsetRing` (inward to a time; outward through a frame),
`triangulate(pts, holes)`. New tests in `test/skeleton-holes.test.mjs`:
`offsetRing` on the notched block at 2, 3 and 4ft wide (closed, closed exactly
at the stop, open 1ft, and at 4ft equal to `eavePolygon` point for point); on
a slot 0.5ft wide 6ft deep (closed); on a dovetail (closed); a court 2.5ft
wide offset 1.5 inward (no loop); a dumbbell court pinched by its eave (two
loops); a square offset outward equal to `eavePolygon`'s answer. For
`triangulate`: the square with a centred hole and the bowed hall with a round
court each give triangles that cover outer less holes exactly, none outside
the outer ring, none with its middle inside a hole; with `holes` empty the
shipped answer for every face of every skeleton test, pinned. Each fails on
the old code (no `offsetRing`; `triangulate` ignores the second argument and
covers the hole). Browser: none. Leaves: the wiring.

*Implementation note, 2026-10-19 (worker TG-28-holes2, #997).* Shipped as
written, with one finding. The frame's margin of `4|d| + 10` (2.2) does not
keep the frame clear: a corner moves at `1/sin(θ/2)`, so a 4.6 degree spike
(a triangle 100ft long and 8ft wide) runs 37.5ft out by 1.5, meets the
frame's loop, and `offsetRing` refused a ring `eavePolygon` takes. The frame
stands `|d| · (v + 2) + 10` clear now, `v` the fastest corner's speed, and a
loop that mixes the ring's edges with the frame's still returns null. Every
figure in the increment held as stated. `offsetRing` returns each loop
starting at the vertex from the ring's lowest-numbered corner still
standing, so with no event it is `eavePolygon`'s answer in `eavePolygon`'s
order. The bridge order (rightmost hole first) only fixes the answer: each
bridge is tested against every ring and every earlier bridge. Increment 3
starts from here.

**3. Flat roofs: the deck with a hole and the inner parapet.** `roof.js`:
`roofOutline` returns `holes` (a room's own hole, and a court between rooms,
contained loop by loop), `curvedLoopsOf`'s new shape, `inFootprint`,
`parapetOnChords`/`chordPlan` with hole rings in the parapet and the deck,
`roofCover` less the holes; `render.js` one line for a deck with holes;
`skeletonRoofsOf` and `curvedRoofs` take only footprints with no holes for now
(the hip stays on rectangles over a court until increment 4), so this is
`parapet` only. New `test/roof-holes.test.mjs`: the bowed hall with a 12 by 8
court under `parapet`: the parapet runs on the chords and round the court,
the deck is the outline less the court, the takeoff and estimate count
`loopArea(outer) - 96`; the same with the court made of four rooms round it,
same figures; a rectilinear courtyard building under each style, plan
byte-identical to today's. Rewrite with this increment: `roof-curve`'s "a
courtyard is refused, and says so" and "a room with a hole of its own is
refused" (they now get `holes`); `roof-courtyard`'s "alone, ... refused
exactly as before" (now: accepted, no curve, rectangles). Browser: extend
`curved-parapet` in `test/tools/run.mjs`, or add `curved-parapet-court`: the
deck triangles over the building, none with its middle in the court, area the
outline less the court once over. Leaves: the hip over a court.

*Implementation note, 2026-10-19 (worker TG-28-holes3, #998).* Shipped as
written, questions 2 and 4 on their defaults, the 108-case hash unchanged.
Four findings. (1) A room's own hole goes into `unionOf`'s edge
bookkeeping wound against its outer ring, so it comes out exactly as a court
between rooms does, and a room filling a hole cancels its walls as a shared
wall would; one rule for both, and the court is a hole of the *smallest*
loop round it, so a courtyard building standing in another's court keeps its
own. (2) A loop standing in another's court is no longer an overlap. (3) More
tests pinned the refusal than section 1 lists: also `roof-curve`'s empty
storey (the return shape), `roof-courtyard`'s "beside a courtyard building"
and "a courtyard on the curved building itself", five in
`roof-groupwalls.test.mjs` that used the courtyard L as a refused building,
and `roof-takeoff`'s list of mask-counted roofs; each was rewritten to the
new answer, and "a curve on a courtyard keeps the rectangles" only in its
outline line, since its hip half is increment 4's. (4) `buildingsOf` groups a
room with a hole with a separate room standing in that hole (`roomsMeet`
asks every ring), which only matters where the storey is refused as a whole;
left in the WISHLIST. `roofPlan`'s rectangle test through `inFootprint` is
the old `pointInRing` until a skeleton block carries holes. Increment 4
starts from here.

**4. Hipped roofs over a courtyard.** `roof.js`: `courtEaves`, `curvedRoofs`
with holes, `skeletonRoofsOf` taking footprints with holes; `elevation.js`
`roofHeightAt` through `inFootprint`. Tests in `test/roof-holes.test.mjs`:
the bowed hall with its court under `hip` at 2, 6 and 12: every face on its
plane, faces of the court's edges rise from the court eave 1.5ft inside the
court, `roofHeightAt` null in the court and at the eave height 1.4ft into it,
`roofCover` the outline less the court sloped at the pitch; a court 2.5ft
wide keeps the rectangles (question 3's default); two courts; a round court.
Rewrite: `roof-curve`'s "a curve on a courtyard keeps the rectangles". Fails
on increment 3's code (the hip over a court is rectangles there). Browser:
`curved-roof-court`, as `curved-roof`: every roof triangle inside the eave
and outside the court eaves, covering the eave less the court eaves once.
Leaves: the head-on notch, the pinch.

*Implementation note, 2026-10-19 (worker TG-28-holes4, #999).* Shipped as
written, question 3 on its default, the 108-case hash unchanged. Four
findings. (1) `skeletonRoof` had not taken holes yet (3.1 lists it, no
increment named it), so it does here; with no holes its faces and return
carry no new key (`ring`, `holes`), so a shipped block is the same object
key for key. (2) "`roofHeightAt` ... at the eave height 1.4ft into it"
cannot hold beside "null in the court" once the test is `inFootprint`, as
3.3 says: 1.4ft into the court is under the court's overhang and in no
footprint, so it reads as sky, as the outer overhang does. The test reads
null there and, 1.4ft back into the building from the court wall, the court
face's plane at the eave plus 2.9ft times the pitch. (3) Four more old tests
pinned the hip over a court as rectangles than this section names:
`roof-courtyard`'s courtyard on the curved building, `roof-groupwalls`'
hall touching the L, and two in `roof-takeoff`; each was rewritten to the
new answer. (4) In `curved-roof-court` it is the area line that fails with
the skeleton built without its court (2326.30 ft² against 2281.30), not the
"inside the court's eave" line: the 9 by 5 court eave holds no triangle's
middle. Increment 5 starts from here.

**5. The head-on notch.** `roof.js`: `eaveLine`'s third answer. Tests: the
notched hall of `roof-tightcurve.test.mjs` with the square notch, a slot and a
dovetail, each now on its skeleton with an eave straight past the notch, every
face on its plane; a curved hall whose court has a head-on notch of its own
(the court's inward offset closes it). Rewrite: `roof-tightcurve`'s "a notch
whose sides meet head on is still refused" and `roof-curve`'s "a notch
narrower than two eaves closes up and is refused". Before writing code, run
the 108-case hash and every `roof-*` test against `eaveLine` with the third
answer in place: a shipped loop that returned null there before and does not
now is a moved hash, and the increment stops to report it. Browser: none new
(`curved-roof` covers drawing a skeleton block). Leaves: the pinch.

**6. The courtyard that meets the outside at one corner.** `skeleton.js`:
`cleanPolygon({ pinch })`, carried through `straightSkeleton` and
`offsetRing`; `roof.js`: `unionOf` keeps the loop through a corner twice, with
`pinch` set. Tests: the L with its court touching the inner corner (10 faces,
rise 10, 1100 ft²), as one ring and as rooms (four rooms round a court as in
`roof-pinch.test.mjs`, with a curve on one), under `hip` and `parapet`;
`cleanPolygon` without `pinch` refusing it exactly as now; a corner on an
edge's interior refused with `pinch` set. Rewrite: `roof-pinch`'s "a pinch
still refuses ... a courtyard" (the room-inside-another half stays). The
eave at a pinch: the outer and the court eave meet there; the test says what
the eave line is (two loops touching at the corner, or one), and the
implementer checks it against the frame offset before deciding. Browser:
none new. Leaves: gable.

**7 (optional, after question 5). Gable over a curve, the weighted
skeleton.** At least two increments: the weighted wavefront, pure, with its
own tests (a rectangle with both ends weight 0 gives `blockRoof`'s gable,
point for point; an L; a hall with one straight end); then the wiring
(`skeletonRoofsOf` for `gable`, the gable faces into the block's `gables`,
`roofPaints` drawing them as `gable`). Not started without Devon's answer.

## 5. Left out on purpose

- **A rectilinear courtyard building on the skeleton.** It reads right on
  rectangles now and every such school's plan would move (question 1).
- **The site plan's building line.** It draws the ground storey's mask
  whatever the roof (`blueprint.js`, `maskOutlines(roofMask(ground))`), stepped
  on a curve with or without a court; a call of its own, already on the
  WISHLIST.
- **The takeoff counting the eave.** It counts the roof inside the walls on
  both paths (#970), and a court's eave is counted the same way: not at all.
- **A gutter, a downpipe or a drain in the court.** A pitched roof over a court
  sheds into it; nothing here draws where the water goes.
- **The court's floor.** The ground storey under an open court is whatever the
  rooms and the site say; nothing here paves it.
- **The elevation's painter order** across a court (a far slope seen through
  the court over a near one). It sorts faces by their nearest point, as for a
  valley, which nobody has checked by eye; a court adds the same risk, not a
  new one.
- **A `test/visual` capture of any of this.** The sample school has no curve;
  adding a capture moves a baseline, and that is a session of its own.
- **The look on a real GPU.** Windows, as for every roof since #967.

## 6. Questions for Devon

Not answered here. Each has the default an implementer takes until he does,
marked **Default**.

1. **Should a rectilinear courtyard building move to the skeleton too?** Today
   a courtyard school with no curve is hipped as rectangles, which is how such
   a building is often built, and its plan is stable. On the skeleton it
   would be one continuous hipped roof round the court. Every such design's
   roof would change, which moves the hash.
   **Default: no.** The skeleton path stays for footprints with a curve.
2. **A curve only in the court** (a round or bowed courtyard in a
   rectilinear building): does that building take the skeleton?
   **Default: yes**, a curve on any ring of the footprint, because the court's
   staircase of 4ft hips is the same fault as a curved outer wall's.
3. **A court narrower than two eaves (3ft) under a pitched roof**: refuse the
   building (rectangles), or let the eaves close over it, roofing the light
   well?
   **Default: refuse**, keeping the rule that nothing is drawn that was not
   drawn.
4. **A room with a hole versus a courtyard of rooms**: today's WISHLIST asks
   whether a room's own hole should be a hip (a court) or a parapet deck
   bridged round it. This design treats them alike, by roof style: a hip
   stands round it, a parapet runs round it.
   **Default: alike, by the roof's style.**
5. **Gable over a curve**: build the weighted skeleton at all, and if so, which
   edges are gable ends?
   **Default: not built**; gable over a curve keeps its rectangles. If built,
   a straight end wall square to the ridge is a gable end and a curved end is
   hipped.
6. **The single-corner courtyard's eave at the corner** (the outer eave and the
   court's meet there, as two lines touching at one point): accept that, or
   refuse the pinch under a pitched roof and roof it only under a parapet?
   **Default: accept**, after increment 6's check of the frame offset at the
   pinch.

## 7. How the numbers were checked

A copy of `js/skeleton.js` at f2afe57 and a 181-line scratch prototype of
section 2.1 (the shipped wavefront with ring-local neighbours, the merge event
searched across loops whatever the input, and a stop time) were run under Node 22 on huginn in
`~/.cache/selector-scratch/TG-28-holesdesign/`, which is deleted when this
session ends. For each shape it printed the faces, the rise, the largest
distance of any face node from its own plane at its `t`, and the faces' total
plan area against the outer ring less its holes. Run and seen:

- the eight hole cases of section 2.1, all on their planes to 1e-13ft, areas
  exact;
- the bowed hall and an L with no holes, against the shipped
  `straightSkeleton`: faces identical by `JSON.stringify`;
- the notched block at 2, 3 and 4ft, outward through a frame to 1.5ft;
- the L with a court touching its inner corner, as one weakly simple ring with
  `cleanPolygon` bypassed: 10 faces, on their planes, 1100 ft²;
- the same court given as a separate hole touching the L's corner: threw
  `open face`; a court given as a hole touching a square's edge at its
  midpoint: returned, 8 faces, **20ft** off their planes, area 1625 ft² against
  1500. That is the case the gate in 2.3 exists for.

Not run: `triangulate` with bridges, a court's inward eave as its own
offset, the pinch under `offsetRing`, any wiring, any browser. Those are the
increments' to prove.
