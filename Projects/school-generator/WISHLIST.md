# School Generator — Feature Wishlist

**Status: forty phases are shipped and one is open — Phase 34,
below; arc six is underway: Phases 37, 38, 39, 40 and 41 have shipped, and
Phase 42 — on Claude Opus 5 — is the next open phase in the arc's order.**
Three arcs took a grid
editor to a walkable, furnished, generated, priced, networked school; arc
four built for the person handed the result; arc five for the building
itself; arc six builds for the reviewer; the phases between and after the
arcs fixed what feedback found.
Full history — each shipped phase's original plan, its task list, and the
long form of how it landed — lives in `git log -p WISHLIST.md`; this file
keeps what a builder needs going forward: the architecture, the
conventions learned the hard way, the standing backlog, a compressed
record of every shipped phase with its retrospective, and the open phases.

## What it is

A single-page tool at `Projects/school-generator/index.html`. No build step,
no dependencies beyond a vendored three.js, and nothing to install — push the
file and it is deployed.

It does need to be **served**, which this file used to claim it did not: the
tool is ES modules, and a browser refuses those over `file://`, so opening
`index.html` off the disk gets you the chrome and nothing behind it. Any
static server will do — `npx serve`, `python3 -m http.server`, whatever is
already on the machine. (The `server/` directory is a different thing
entirely: the design store and the session relay, both optional.)

It draws a school in plan and walks through it in first person: storeys,
**rooms** (polygons with ids), walls, doors, windows, stairs/ramps/lifts, a
graded site, a roof. The walkthrough has collision, gravity, footsteps, room
acoustics, a positioned sun, and a school's worth of people walking their
timetable. It reads what it has drawn — occupant load, travel distance,
accessible route, glazing ratio, reverberation time, worst-first — and it will
generate a whole building from a student count and a sentence. It reads the
*school* too: a real or generated timetable, utilisation, passing-period
travel. And it prices what it counts, against a rate table you supply — it
holds no prices of its own.

## The architecture that emerged

**One pure module per question, one thin tool on top of it, one `node --test`
suite per module.** The single most load-bearing habit in the codebase. The
geometry never touches three.js; the tools never do geometry.

The model, bottom-up: `grid.js` (footprint and storeys) · `footprint.js`
(sheet size, what has to fit on it) · `shapes.js` (rooms: rings, holes,
per-segment walls) · `wallrun.js` (a wall drawn point to point, and the
free-standing ones a room's boundary cannot say) · `snapgrid.js` (the
drawing grid's pitch, its phase, the point a wall aims at and the tile a
floor lands in) · `gridref.js` (where the grid starts, and the one rule that
keeps moving it safe) · `lattice.js` (the drawing raster, and `bake()`, the
one door out of it) · `paint.js` (the
brush, and the raster it draws on) · `props.js` (object layer,
inter-floor links) · `catalog.js` (every placeable type, as data) ·
`walls.js` / `openings.js` / `finish.js` (derived thickness, door leaves,
window bands, floor/paint) · `stairs.js` (runs, landings, the holes they cut)
· `terrain.js` / `site.js` / `roof.js` (ground, site drawing, roof) ·
`rates.js` (cost vocabulary) · `history.js` (an edit as a diff) ·
`save-load.js` (v12, one migration that ever changed a shape).

What it derives: `navgraph.js` + `navmesh.js` (walkable surface as convex
tiles, graph over it) · `sitemesh.js` (the same, over the outdoors) ·
`collide.js` (what stops/holds you up) · `clearance.js` (Phase 40: the chair —
the door-width contract, the seated body as step rules, the turning circle and
the reach ranges, one module the report and the walker both read) ·
`codes.js` (Phase 41: the code editions as data — factors, limits, widths
and the table each is quoted from, one row per offered edition, read by
every analysis below) · `range.js` (a number that knows how sure it is) ·
`commonpath.js` (the walk to the first point with two separate ways out,
as two node-disjoint paths on the graph) ·
`occupancy.js` / `egress.js` /
`daylight.js` / `takeoff.js` / `acoustics.js` / `utilisation.js` / `cost.js` /
`spec.js` / `phasing.js` / `report.js` (analysis, none of it stored) ·
`lights.js` / `sky.js` / `sound.js` (emitters, sun, audio sources) ·
`bakelight.js` (illumination baked against sightline's occluders, off the
main thread in `bakeworker.js`, cached by `bakestore.js` beside the
autosave — never in the file) ·
`shadow.js` (what an upper storey stands on) · `blueprint.js` (the printable
set: plans per storey, four elevations, drawn sections, site and spec sheets,
numbered through one title block) · `elevation.js` (Phase 37: the model
projected onto a vertical plane — facades and section cuts as depth-sorted
fills a painter draws far-to-near; also the stored section-line records) ·
`annotate.js` (Phase 38: what the sheet says — dimensions as two anchors
and an offset whose number is derived at draw time, notes as a point, a
leader and a sentence, and the chain that dimensions a wall jamb to jamb
off its own opening records) ·
`minimap.js` · `signage.js` (Phase 31: the plate beside a door and
the glowing EXIT over it, both read off the model — which door, which jamb,
which side, how high).

What it generates: `program.js` (room counts) · `brief.js` (a sentence read
into that program) · `timetable.js` (class/room/period packing) ·
`generate.js` (room placement, four schemes) · `autofurnish.js` +
`templates.js` · `sample.js`.

What it plays: `schedule.js` (the day as five numbers) · `agents.js` (a
seeded population with timetables) · `shove.js` (bump a chair) · `hunt.js`
(scavenger hunt) · `decor.js` (seasonal palette) · `lift.js` (a car with a
call button and a queue) · `threshold.js` (Phase 39: a doorway's admission
rate — the morning crush, metered) · `haunt.js` (Phase 24's night: the stage
machine, the writings, the crash, the way out) · `creature.js` (the one body
in it) · `murmur.js` (Phase 28: the crowd as sound — emitters from
occupancy, the room tone, the PA's script).

What it shows and shares: `render.js` (the three.js scene) · `relief.js`
(Phase 31: what shape a material is — a tileable height field per grain
family and the tangent-space normals that fall out of it, arithmetic rather
than canvas) · `audio.js` (Web
Audio graph) · `walkthrough.js` / `xr.js` / `touch.js` (three input paths,
one physics) · `gltf.js` + `models.js` (glTF read/written by hand) ·
`share.js` (a design deflated into a URL fragment) · `tour.js` · `overlay.js`
· `gallery.js` (Phase 30: the front door's three finished schools — the
recipes, the plan thumbnails and the counted facts, with the payloads
themselves generated into `gallerystock.js` by `tools/make-gallery.mjs`).

What it is, as a program rather than a page (Phase 30): `offline.js` (which
requests the service worker keeps, and for how long — `sw.js` is its three
listeners and nothing else) · `filestore.js` (the design as a document: a
session, a dirty flag, a filename, and which failures deserve a sentence) ·
`demo.js` (a tool's own gesture as timed pointer events, so the tutorial and
the smoke test are one artifact).

What it shares with another person: `session.js` (a design as records, and
which of two edits wins) · `presence.js` (who else is here) · `wire.js` (the
pipe — loopback, `BroadcastChannel`, or a WebSocket relay) · `cloud.js` (a
design store, client + contract) · `server/` (the store and relay
themselves, no dependencies). **No module above this paragraph imports any
module in it.**

The editor is `editor.js` plus one tool per verb — `polyedit`, `propedit`,
`stairedit`, `templateedit`, `siteedit`, `overlayedit` — each thin over a
pure module, and `main.js` wires all of it to the DOM. The vertex tool's
whole-section gestures sit on `section.js` (Phase 32: a set of records,
repeated — the marquee's hit test, the room clipboard with the props inside
it, the stamped row, and the storey-wide move).

## Conventions a new builder must know

Read these before the first edit. Every one of them was learned by getting it
wrong.

- **Add a pure module and its test suite together.** No exceptions.
- **There is one kind of room, and it has an id.** A room is a polygon with a
  record: `{ id, name, color, fin, paint, group, load }`. The 4ft lattice is a
  *drawing surface* only — everything that paints, generates or loads goes
  through `bake()`, and nothing downstream of it knows a lattice was
  involved. Anything that wants to name a room from outside the file names
  its id.
- **Save-format changes stay additive**, are validated in `deserialize()`,
  and never rename the autosave key. Unknown content survives; unknown
  boundaries default to *more* solid, not less.
- **Derive, don't bake.** Stair cuts, guardrails, blueprint symbols, wall
  thickness, collision segments and the nav mesh are all computed on demand.
- **Every boundary kind blocks the walker and bounds flood-fill by default.**
  New kinds opt *out* of solidity, never in.
- **Prop geometry builders return one merged, vertex-coloured
  `BufferGeometry`,** bottom at y=0, facing +Z, sized from the catalog row.
  One shared material; colours baked per vertex, keyed on type *and* paint.
- **The sheet starts at the origin and grows +x and +z.** It has a size but
  never an origin — fitting something onto it is two moves: slide the thing
  onto the positive quadrant, then grow the sheet. Growing is always safe;
  shrinking can clip a room the brush later repaints. See `footprint.js`.
- **The *grid* has a phase, and the sheet still does not.** Phase 35 lets
  somebody index the drawing grid off a point on a traced photograph
  (`gridref.js`); the sheet's corner does not move, the grid's lines slide
  across it. The reference point can only be set while nothing is drawn,
  because re-phasing a grid under an existing plan takes every room off it —
  `gridLocked` is that test, and it is a refusal with a sentence, never a
  silent no-op.
- **A floor lands on a square, a wall lands on a point.** Both are read off
  the same grid at the same pitch, so what the sheet draws is what the brush
  lays. The paint raster may be *refined* under a plan (4ft to 2ft) and never
  coarsened: a finer raster accepts every room a coarser one did, and the
  reverse would strand them. See `rasterOf` / `refineRaster` in `paint.js`.
- **A repaint is O(the storey), so a gesture is one repaint.** `paintTiles`
  takes the whole list of squares a stroke or a rectangle touched. Calling it
  per square — which is what the brush did until Phase 35 — rasterizes the
  storey, re-traces every region and re-hangs every door once per square.
- **Anything outside the file that names a room names its id, and keeps the
  name it bound by.** Bind by id, then by name, then by room number — never
  drop what you could not bind: report it. See `bindRoom` in `timetable.js`.
- **Selection lives in tools, never in the file.** So does anything that is a
  decision about the editing session rather than the building. Anything that
  is a fact about the *building* (occupancy group, design occupant load, code
  edition, sprinkler answer) belongs in the file.
- **The walkthrough collider's walls are built once at walk-start; its props
  can be invalidated.** *Structural* editing and walking are exclusive —
  rooms, walls and storeys still never change mid-walk. Furniture can (Phase
  22's hands), and `refreshProps` in collide.js is the one door for it: prop
  obstacles re-derived from the design in place, walls and the live door
  leaves untouched. The crowd owns the colliders when it is running — which
  is exactly what makes one refresh reach the camera and every agent at once.
- **Ctrl-combos route through `main.js`,** not through the tools' generic key
  handling.
- **Undo restores a snapshot with `Object.assign`, which only ever adds.**
  Any *optional* record on the state (`terrain`, `site`, `roof`, `life`,
  `timetable`, `overlay`, `models`, `tours`, `haunt`, `weather`) has to be
  deleted when the snapshot doesn't have it, or undoing past the moment it
  was first written silently does nothing.
- **A `PlaneGeometry` flattened with `rotateX(-π/2)` has its extents in
  local X and Z.** `scale.set(w, d, 1)` gives a plane one unit deep.
- **Handing a bare `'#rrggbb'` string to a colour buffer silently writes
  NaN**, which reads back as black. `coloredGeo` normalises; anything new
  that writes colours must too.
- **`mergeGeometries` refuses to mix indexed and non-indexed geometry.**
  `mergeVertices` welds the non-indexed one.
- **The prop rotation convention counter-rotates against section rotation**
  (`rotationY -= φ` when the room turns by φ). Read the comments on
  `rotateShape90` / `rotatePoint90` before touching it.
- **A pure module is only as honest as the state its tests put it in.** Test
  from the state the caller actually produces — `test/build.mjs` draws on a
  scratch lattice and bakes it, exactly as the editor, generator and loader
  do. Keep at least one test per arc that *runs the thing* rather than
  calculates about it; three separate phases have shipped a regression that
  every calculating suite missed and only a simulating one caught.
- **There are three test passes, and a tool belongs to the third.** `node
  --test 'test/*.test.mjs'` is the numbers (and the glob is not decoration —
  `node --test test/` dies with `MODULE_NOT_FOUND` on Node 22).
  `test/visual/run.mjs` is the pictures. `test/tools/run.mjs` is the *tools*:
  the fourteen of them driven with real pointer events on the real page,
  because `editor.js` and the seven `*edit.js` modules all import three.js and
  so cannot be loaded in Node at all. If you change what a tool does to the
  state, that is the pass that will tell you. All three run in CI on every PR
  that touches this directory; the last two need Playwright and are optional
  locally — a machine without a browser loses them, not the suite.
- **A generated source file needs a tool that writes it and a suite that
  proves it has not drifted.** `js/gallerystock.js` is 90 KB of committed
  bytes nobody will ever read; what makes it trustworthy is that
  `tools/make-gallery.mjs` regenerates it from recipes that live in
  `gallery.js`, and `test/gallery.test.mjs` rebuilds those recipes and fails
  if the committed facts or thumbnails are no longer what the generator
  makes. Payloads are compared by what they *decode to*, never byte for byte
  — two deflates of the same bytes are allowed to differ.
- **A partition belongs to exactly one of the two rooms it divides.** One
  builds a wall on it, the other leaves the segment open, decided by reading
  order at bake time. Anything that has to be true of *both* sides (borrowed
  light) has to say so explicitly.
- **...and so does the door in it, which is why nothing may look for a
  room's doors on a room's own rings.** Half the classrooms in any real plan
  have none: theirs is recorded on the corridor that shares the wall. Walk
  every opening on the *storey* and let `shapeAt` say which rooms each one
  divides — `signage.js` does, and the first cut of it signed six rooms out
  of eleven and looked like a placement bug.
- **What a person looks like is drawn apart from what a person does.** The
  crowd's appearance comes off its own generator, seeded from the
  population's seed and the agent's id (`wardrobeOf`), because a field added
  to `makeAgent` shifts every draw after it — so a purely cosmetic addition
  moves where everybody spawns and how fast they walk. Anything the renderer
  needs per frame that the agent can know (`bob`) is *written onto the
  record* by `stepAgents` rather than recomputed in render.js: the scene
  reads the crowd and never knows a formula.
- **`hand` and `sw` are relative to the run, and a run has a direction.** A
  ring is wound, so half its segments run the other way; a door copied onto
  one without flipping both fields hangs on the far jamb. `bake()` and
  `paint.js` both correct for it; anything else that moves an opening
  between segments must too. Since Phase 32 `reverseRing` corrects for it as
  well — re-winding a ring is a re-parameterization, never an edit, so both
  fields flip and the leaf stays on its physical jamb — and a mirror owes
  one extra `sw` flip on top of that, because a reflection reverses
  handedness. Prove a door transform *physically* — where the hinge is,
  which side the leaf swings — never by the stored signs, which a re-wind
  legitimately scrambles (see `doorPhysics` in shapes.test.mjs).
- **A phase's premise is checked against the tree, not against this file.**
  Phase 32 was scoped as "the tool cannot repeat anything" — and Phase 6
  had already shipped shift-click multi-select, Ctrl+C/V/D, R and M on
  whole sections. What was actually missing was narrower and better: the
  paste that lands at the pointer instead of at a fixed offset, the array,
  the marquee, the storey move, and the mirror bug the conventions had
  predicted. The backlog remembers the tool it was written against;
  `git log -p` remembers the tool.
- **Two numbers with the same units are the hardest kind of bug, because
  both of them are right.** An occupant load and a roll both mean "how many
  students" and differ by nearly a factor of two; a takeoff quantity and an
  estimate line can share a name and answer different questions. The fix is
  never to average them — give each its own function, its own citation, its
  own button.
- **A queue that can hold a door open needs a bound on the holding.**
  Everybody waiting for a lift presses the button every frame they are not
  aboard; a car that answers each press never departs. See `lift.js`'s
  `held` accumulator.
- **A cost written into a comment is not a cost anybody has checked.** Phase
  31 shipped a transmission pass into the walkthrough with an honest note
  beside it saying it costs a second scene render — and it cost 117% of a
  frame, which the note did not say because nobody had timed it. Anything
  that adds a render pass, a second traversal or a per-pixel fetch to the
  *walk* gets measured on the software rasterizer before it lands: it is one
  script, and the walkthrough is what the tool is for.
- **A cost that is not a distance is how this codebase says "yes, but".**
  `OUTDOOR_COST`, `STAIR_COST`, `ELEVATOR_COST` and `FLOOR_PENALTY` all
  charge `cost` and never `dist`, so a route can be discouraged from a path
  without lying about how long it is.
- **A property of the answer is not always a property of the search that
  found it.** Measure things like steepest grade on the route once,
  afterwards, rather than threading a running value through the pathfinder.
- **A rule two readers share belongs to neither of them.** Phase 40 needed
  the accessible graph and the seated walker to agree about every doorway,
  and the only way two modules can never disagree is to ask one function —
  `clearance.js`'s `doorRolls` — from both sides. The door-width constants
  had lived in `navgraph.js` since Phase 7; they moved, and every importer
  moved with them, because a re-export is a second name for the same rule
  and the walk bundler refuses re-exports anyway. Corollary for a body with
  rules: a refusal that geometry would also have made has to be made *by
  the rule first*, or it is silent — a chair too wide for a doorway is
  stopped by the jambs like anybody, and the sentence is only owed if the
  door rule is asked before the walls are.
- **A generated school is checked by whatever the newest reader knows to
  ask.** The chair's first pass over every generated school found the
  corridor template standing its locker banks 1.4ft off each wall with a
  bench down the middle, 33in between them — fine for a crowd of 1.8ft
  bodies, impassable for a 32in one, and wrong for a real corridor either
  way. The fix was the template, not the finding.

## The standing backlog

Everything below is open and unclaimed — pull from here for the next phase,
and add to this list rather than starting a new one.

**Model and geometry**
- Switchback ramps — one straight run means an ADA-compliant ramp is 144ft
  long and rarely placeable indoors.
- Curvature isn't stored, so re-bending a wall after a reload starts from its
  chords. Curved walls are chords in the collider too.
- Wall paint is one colour per wall, not per face.
- A pitched roof over a curve is a stepped rectangle; a straight skeleton
  would fix it.
- Site regions can be restyled and deleted but not re-shaped.
- The mesh is inscribed, not exact — a diagonal wall keeps its stair-step,
  and gates are midpoints rather than funnels.
- Nothing you'd duck under rather than walk into (a table, a low soffit) is
  modelled, and the ceiling doesn't stop a body — only structure does.

**Analysis**
- Daylight is a glazing ratio, not a daylight factor — nothing knows about
  orientation, overhangs or room depth.
- ~~Common path of egress travel is a constant that nothing measures.~~
  *Done, Phase 41: `commonpath.js` walks it from every corner of every room
  to the first node with two node-disjoint routes to two distinct exits —
  doorways, stairs and lifts are one body wide, open floor is not — and
  egress.js holds it to the edition's 75ft.* What it still does not do: a
  pair of leaves is one doorway (right), but so is a 12ft cased opening
  (arguable); and a stair is a node, so two stairs off one landing count as
  two ways where a plan checker might want them remote from one another.
- ~~Accessibility stops at routes: no turning circles, reach ranges or counter
  heights.~~ *Done, Phase 40: `clearance.js` tests the 60in circle both sides
  of every doorway on the route and somewhere in every room it reaches,
  sweeps corridors for pinches under 36in, and reads counters, controls and
  work surfaces off the catalog against the reach ranges.* What it still does
  not do: a door's manoeuvring clearance is a circle beside the door rather
  than ADA 404.2.4's rectangle with its 18in latch-side strip; a pair of
  doors is judged with both leaves open (the code judges it by the active
  leaf, so the lattice's 4ft pair passes here and would not on a plan check);
  the outside of an exterior door is not tested; and knee and toe clearance
  under a counter is not modelled at all.
- ~~The code edition is printed, not applied — three editions are offered and
  none changes a factor or limit.~~ *Done, Phase 41: `codes.js` carries one
  full table per edition and occupancy, egress and daylight read their
  numbers off it — and checked against the code rather than the file, the
  three offered editions agree on every Group E number this tool applies, so
  the sheet says "IBC 2021 applied" and means it, and the first edition that
  differs is one row.* What is still not applied: the reduced 0.15/0.2in per
  occupant a sprinklered building with voice alarm may use (the file has no
  alarm answer), and nothing for a Group A assembly space inside the school,
  which the code treats separately.
- A title-block panel prints its three worst findings and counts the rest;
  the full list still lives only in the report panel and the CSV.

**The crowd**
- An imported timetable has no teachers (the `Tools/` CSV has no teacher
  column), so "no teacher free" never fires on one.
- Lunch is still `pickLunchroom` (largest common room) rather than a sitting
  the timetable schedules.
- The corridor crush rule (facilities rule of thumb) and egress width (code
  limit) are never reconciled.
- The last fifth of an evacuation is a tail — a few agents work out of a
  corner the crowd shuffled them into.
- Nobody carries anything or opens a locker. ~~Or talks.~~ *Closed by Phase
  28: pairs stop and chat, and every occupied room murmurs.* Half-answered by
  Phase 31, and only half: most of them now have a bag on their back, but a
  bag that is worn is not a thing that is carried — nothing is ever picked
  up, put down, or taken out of one.*
- An arrival is a person appearing at the curb (Phase 39) — no bus pulls in,
  no car door opens, and the loop's only traffic is trees and paint.
- The front door's admission gate meters waypoint crossings; a hard enough
  crush can still squeeze a body through the opening uncounted, which a real
  crush also does — but nobody is measuring the real one.

**Generation**
- Adjacency cannot move a room into a bigger slot — only same-sized rooms
  swap, so an "away from" rule often can't be honoured at all.
- A generated school is furnished before it's checked — `furnishAll` stops
  at the prop cap and nothing asks whether it was hit mid-classroom.
- The structural shadow is measured at 4ft, so a wing oversailing by three
  feet doesn't register; a room is refused or allowed wholesale rather than
  clipped.
- ~~The tracing overlay is edit-mode only — it isn't on the printed sheet.~~
  *Done, Phase 38: it prints under the plan behind a checkbox in the export
  dialog, at the sheet's own scale.*
- The campus scheme is always the same shape (front building, quad, row of
  pavilions) where a real one wraps a hillside.
- `autofurnish` keeps stamps four feet from a door since Phase 40, which is
  a circle where the code wants a rectangle with a latch-side strip, and it
  still stamps a stair room's furniture as if the run were floor. The chair
  reports what is left.

**Play**
- A hunt cannot survive a structural edit — hints name rooms that may no
  longer exist.
- ~~Warmth is a straight line plus a per-storey charge, not routed, so
  something thirty feet away through a wall reads as hot.~~ *Done, Phase 24:
  `routedDistance` walks the navgraph; the straight line survives only as the
  no-graph fallback and the outdoors' answer.*
- A colour variant cannot recolour an imported model; a prop has one paint.
- The crowd cannot shove anything.
- Hands are desktop-only — touch has no Q, and the palette ring belongs on
  the touch HUD beside the joystick it doesn't yet have.

**Light, sound and picture**
- ~~There are still no shadows from the building's own lights, and light
  doesn't respect geometry, only distance — a troffer shines through the
  wall its range crosses.~~ *Done, Phase 27, for the walk: the bake casts
  every fixture against sightline's occluders and the renderer wears it.
  The editor's live path still lights by distance alone — a drafting table
  wants legible — and props still take the flat lift rather than the field,
  since instanced geometry shares its vertices across the storey.*
- ~~The cloud deck is one coverage and one drift everywhere — no weather, no
  wind, no overcast day.~~ *Done, Phase 29: `weather.js` — overcast, rain and
  snow, one click beside the moods, with the deck, the light, the ground and
  the soundtrack all reading the same derivation.*
- Transmission loss ~~is one number per situation rather than a ray cast~~
  *(the ray landed in Phase 24 — `pathLossRay` counts sightline's segments
  and the live leaves; the constant survives as the cross-slab and
  no-geometry answer)*, and there are still no early reflections.
- The phone got photo mode and the minimap (and, it turned out, the ability
  to boot at all — a missing element had been a TypeError on every touch
  device); the topbar and the tool panels are still desktop-shaped.

**The room model**
- ~~A boundary that bounds no room cannot be drawn.~~ *Closed by Phase 25:*
  `floor.walls` is a boundary that belongs to the storey. What it still does
  not do is bound anything — a wall line drawn across a room does not divide
  it for flood fill, egress or daylight, because it is not part of any ring.
  Draw a room's own boundary and the run lands on the ring instead, which is
  where dividing a room actually happens.
- The brush refuses a free-drawn room rather than straightening it, so a
  curved room can never be painted again. A "straighten this room back onto
  the lattice" verb would close the loop.
- Painting merges nothing, and there is no deliberate "join these two rooms"
  verb either.
- `paint.js` rasterizes every lattice-aligned room on the storey for one
  cell — wasteful on a large plan; the fix is to rasterize only rooms whose
  bounding box the stroke touches.

**The sheet**
- The drawing surface has a size but no origin, so a plan cannot extend into
  negative feet.
- ~~Shrinking the sheet can strand a lattice-aligned room outside it; the
  missing verb is "move everything on this storey by (dx, dz)".~~ *Closed by
  Phase 32: the Slide row on the floor panel moves a storey's rooms,
  free-standing walls and props as one set; stairs and lifts stand on two
  storeys at once, so they stay put and the status line says so.*
- A design's dimensions aren't part of what a scheme generates against — the
  generator always sizes a fresh state from its own plan.
- ~~The wall drag's parallel-segment fix isn't applied to the erase tool.~~
  *Moot since Phase 25:* there is no wall drag. The eraser still strokes,
  and still takes whichever boundary is nearest each sample.
- Undo is a diff and arrays diff by index, so splicing out of the middle of
  a long list re-states everything after it — first place to look if a delta
  ever comes out surprisingly large.

**The session**
- A storey has no id, so adding or removing one is a whole-design resync
  that can discard a concurrent peer edit.
- The tracing image and model library travel only in a snapshot (join or
  resync), not live.
- Nothing is acknowledged and nothing is retried — a dropped op stays stale
  until rejoining repairs it.
- Undo is local and wins — undoing your own edit re-states it with a newer
  stamp, beating a peer's later change to the same record.
- An op carries the whole record, so dragging a vertex of a large free-drawn
  room sends the whole outline.
- Whoever runs the relay sees the designs that pass through it, and anybody
  with a store link can read that design. Making either private needs
  accounts.
- **The server is unshipped as a deployment** — it runs and is tested, but
  somebody has to run it somewhere, and TLS in front of it is the one step
  that is neither in the code nor optional (a page on `https:` cannot call
  an `http:` store).

**Files and performance**
- glTF textures, PBR materials, skins, morph targets and Draco are each a
  refusal with a sentence attached in `gltf.js`.
- A tour moves the camera and does nothing else — no bell at a stop, no hour
  scrubbed, no audio on the recording.
- The walk export ships three.js as source — 2.6 MB that would be a quarter
  of that gzipped, if a compressed variant is ever worth the complication —
  and leaves the headset out: `xr.js` rides the bundle but no VR button does.
- **Most of the tool still loads before the first frame.** `lazy.js` exists
  and `generate.js` (the largest module, 108 KB) now arrives when somebody
  presses Go, but the boot payload is still ~3.5 MB over a hundred requests.
  What stops the rest is not the mechanism, it is the import graph — the
  obvious candidates are each pinned eager by something on the boot path:

  | module | pinned by | what it would take |
  | --- | --- | --- |
  | `blueprint.js` (54 KB) | the **minimap**, which calls `computeFloorPlan` / `drawPlanBody` every frame in walk mode | a plan cache the minimap can fill asynchronously, or its own tiny plan builder |
  | `agents.js` (61 KB), `timetable.js`, `phasing.js`, `rates.js`, `tour.js`, `models.js`, `haunt.js`, `occupancy.js` | `save-load.js`, which normalizes each of their records on load | a registry the loader consults, so a record is normalized by the module that owns it once that module is present |
  | `gltf.js` (29 KB), `hunt.js`, `xr.js` | `render.js` | the scene asking for them at the moment it draws one, not at import |
  | `report.js` and its tail (`cost`, `spec`, `egress`, `daylight`, `utilisation`, `takeoff`) | `main.js`'s panel renderers, which are synchronous | the panels becoming async, which is the same shape of change as the Generate button |
  | the collab stack — `session`, `wire`, `presence`, `cloud` (54 KB) | ~50 call sites in `main.js`, one of them (`createRoster()`) at module top level | a `collab` object built on first use rather than at load |

  None of it is hard; all of it is in the untested tool/UI layer, so do it
  behind `test/tools/run.mjs` rather than in front of it.
- ~~The vendored `libs/` are 1.3 MB — 36% of the payload — and cannot be
  cached hard because the paths carry no version. Putting the version in the
  directory name would buy an `immutable` year on every return visit, and
  costs one edit to the import map plus a rebuild of
  `walk-template.html`.~~ *Closed, Phase 30, and more cheaply than that: the
  service worker's cache is named for the worker's own revision, so within a
  revision `libs/` is answered from disk with no network at all and bumping
  `REV` invalidates the lot. Not one import path moved, and the walk template
  was never rebuilt. See `offline.js`.*

## Arc four — the guest

Three arcs built a tool for the person who draws it; arc four built for the
person who is handed the result — the visitor's first five minutes, the eye
that decides whether to stay, the walker who learns the building by walking
it rather than reading it, the friend with no tool at all, and, as an *and
also*, the player in the dark. All six phases shipped.

One convention arrived with this arc, and it is about phases rather than
code: **each phase names the Claude model that should run it.** The rule is
that anything touching the model layer — a new pure module, the save format,
the collider contract, visibility math, the export bundler's module
surgery — runs on Claude Fable 5; surface work — DOM wiring, CSS, render
presets — runs on Claude Opus 5 or Claude Sonnet 5. No phase in this arc was
small enough for Haiku, and that is a judgment, not an oversight.

## Phase 19 — The first five minutes *(shipped)*

**The tool rewards the hundredth hour and punishes the first five minutes.**

Shipped the opening moment (first visit offers three doors — walk a sample
school, generate one from a sentence, start blank), the Ctrl-K command
palette fuzzy-matched over every verb `main.js` wires with each result
showing its hotkey, a coach that surfaces one hint at a time, the walk-mode
key sheet regrouped by how soon a guest needs it, a phone-sized photo panel
and minimap, and findings put where the eye is — the title block prints its
three worst in words, and an open report finding carries "⌖ Show it on the
plan". Judged by one test: somebody who has never seen the tool reaches a
walkable school in five minutes without opening this file.

*What fought back:* running the tool on an actual phone found that it never
booted on one — `main.js` had written a touch hint into an element two
redesigns had removed, a TypeError before init finished. And the chrome pass
found `--accent-soft` defined as `var(--accent-soft)`: every active-state
wash had been transparent for two phases. Both are the kind of bug only
*looking* finds, which is what the phase was. *Save:* — none, as planned;
three localStorage flags (`sg-welcome-seen`, `sg-hints-said`, and the visual
harness pre-seeds the first). The palette routes through the same handlers
the hotkeys call — no rival keymap — and is under the visual harness as
`chrome-cmdk`, with the opening moment as `chrome-welcome`.

## Phase 20 — Worth a screenshot *(shipped)*

**The picture is honest. Honest is not yet worth looking at.**

Gave the picture character without a new pass: five one-click time-of-day
moods (`MOODS`/`applyMood` in sky.js, writing the existing `env` record
whole), troffers that actually light off the ceiling-pan lattice with the
invented `HOUSE_FILL` retired, four-octave value-noise clouds on a second
sky shell, per-family finish roughness (`makeFinishRoughness` — matte pile
on carpet, per-plank satin on wood, polish with matte chips on terrazzo, a
low-sun glint on standing-seam metal), and chrome restyled as dark glass
that belongs to the pictures the tool makes.

*What fought back:* the first night walkthrough was white. Real troffers per
pan plus a spill that every school now saturates plus the night exposure
lift stacked into a washout, and the tune that landed is stated in
lights.js: 1,000lm a pan (a four-pan cluster ≈ one real 2x4) and `SPILL_MAX`
down to 0.30 — the level the old invented house fill sat at, now earned.
*Save:* — none, as planned; a mood writes fields v11 already has.

## Phase 21 — Line of sight *(shipped)*

**A label the walker did not earn is information through a wall.**

`sightline.js`, pure with its suite: 2D occlusion casts in plan that gate
walk-mode room labels on line of sight to the room's door — *earned* (a
label learned when its door is first seen, the walk's default), *strict*,
*all* and *none*, cycled on `I` — throttled to four casts a frame, nearest
door first. Edit mode keeps always-on labels, and the gate is rebuilt per
walk. This is the module Phase 24 later hunts you with.

*What fought back:* two things, both geometric. A cast aimed *at* a doorway's
centreline never strictly crosses the shut leaf lying exactly along it —
`segsCross` is strict at endpoints, correctly — so the cast reaches
`DOOR_PAST` beyond the wall, through the hole or into the leaf. And the plan's
"the segments collide.js already derives" did not survive contact: sight has
its own idea of a wall. `wallSegments` puts glass and railings in with
drywall (right for a body, a lie for an eye) and never cuts a window, so
`sightSegments` derives its own occluders — glass and rails pass whole, a
window is a hole only where the eye height falls within its band, and a
clerestory stays a wall. A door on a shared partition belongs to one room's
ring and to *both* rooms' sight, which is `doorPoints` probing both sides the
way the navgraph's portals do. *Save:* — none, as planned; one localStorage
preference (`sg-labels`). *Model:* **Claude Fable 5**, as named.

## Phase 22 — Hands *(shipped)*

**In walk mode you have feet and no hands.**

Walk-mode placement: Q picks a real prop into a carry slot (`carry.js`,
pure, with its suite), it stands at its snapped set-down spot ahead of the
view through the editor's own `snapProp` tiers, R turns it, X puts it back;
a walk palette of eight catalog favourites on the digit keys; and the
collider convention renegotiated in the open — `refreshProps` re-derives
prop obstacles in place while walls and door leaves stay built-once,
reaching the crowd's collider too because they are the same objects. A walk
placement writes the file like any other props edit; placement refuses only
overlap, never consequence — you can trap yourself, and the fire drill will
tell you what your barricade did.

*What fought back:* the rotation convention, again — under it local +x
swings toward −z, and the first overlap test was written for the other
handedness (read the note atop propplace.js *before* the test, not after it
fails). Escape turned out not to be cancellable: under pointer lock the
browser owns Esc, so putting a carried prop back is X. And the carried
ghost is not a floating prop but the real instance standing at its snapped
target — you look at exactly what a set-down commits, the editor's
footprint-plane ghost says whether it fits, and `moveProps` learned an
explicit `y` so a prop carried up a stair poses on the storey it is going
to. One deliberate consequence: a committed placement redraws the scene
from the file and refreshes the colliders from the file, so everything the
walk had *shoved* snaps back where it was drawn — the picture and the
physics agree, because they are read from the same place. *Save:* — none,
as planned (existing props records; no schema change). *Model:* **Claude
Fable 5**, as named.

## Phase 23 — The walk you can hand to somebody *(shipped)*

**Sharing the school still means sharing the tool.**

One self-contained walkable `.html`: `walk-main.js` boots straight from an
embedded design to pointer-lock walk — collision, doors, the lift,
acoustics, labels-by-sight, the crowd and its drill, the moods; no editor,
no analysis, no session stack — and `tools/export-walk.mjs`, the house
bundler, walks the static import graph and rewrites it into one script
spliced into `walk-template.html`, committed like a fixture with a
byte-for-byte staleness test and a 4 MB budget it landed a third under.
The exported file opens from `file://` with zero network requests and
embeds its own deserializer and codec, so old exports open forever.

*What fought back:* less than the plan feared, and the plan gets the credit:
twenty phases of house style meant the graph had no default exports, no
re-exports, no `export let` and no cycles anywhere in the walk's reach, and
the vendored three keeps its hundreds of exports in one final statement — so
the "biggest single piece of surgery since the nav mesh" was four regexes
against a discipline, and `render.js` was carried whole rather than split
(2.6 of the 4 MB budget said the split wasn't needed, and the phase was told
to refuse surgery the export didn't need). The one real scare was a black
viewport in the headless smoke test — chased into the *tool*, where
`test/visual`'s own chrome-edit baseline turns out to have the same black
viewport: a SwiftShader artifact, identical on both sides, and the export's
scene draws fine where the tool's does. *Save:* — none, as planned (embeds
v11 as-is). *Model:* **Claude Fable 5**, as named.

## Phase 24 — Lights out *(shipped)*

**A building that can host a school day can host a bad night.**

The haunted night, off by default behind an additive `haunt` record (save
v12): `haunt.js` — a five-stage machine `day → dismissal → dusk → company →
flight`, a pure function of `(finds, elapsed, seed, intensity)`, carrying
the writings, the flicker curve, the fake crash and the way out — and
`creature.js`, a lean stepper rather than an agent, that prefers the
corridor you are not looking down (`sightline.js` inverted), stops when
seen, closes when not, and is broken by the doors that slam behind the
fleeing player. Sound finally went through walls by ray (`pathLossRay`,
which daytime acoustics inherited free) and warmth went routed over the
navgraph; the haunt runtime ships only in the walk export — the tool arms
the record and never turns itself.

*Save:* v12 — one optional record, the cheap kind. *Model:* **Claude Fable
5** — chase and hearing are navgraph and occlusion math; the writing set is
the only line of it any model could do.

*What fought back:* the flicker trap was real — `updateDynamicLights`
early-returns on `lampLevel`, so the seam multiplies *cached base
intensities after the budget* and never touches the level; the spill and
fixture glow ride the same curve or a corridor stays lit while its lights
die. The routed warmth's first cut charged a detour to the middle of the
destination room (the room node), and its second discovered that a corner
place's next-door test point was *outside the building* — both times the
routed answer was right and the fixture was lying. The exodus reuses the
drill with the klaxon deliberately unplugged (a dismissal is a bell), capped
at 75s with stragglers vanishing under the first blackout. The one scope
call against the plan: the haunt *runtime* lives only in the walk export —
the tool arms the record (one palette command, a native prompt, "· haunted"
on the export note) and never turns itself; playtesting is downloading the
export, which is one click and is the artefact that ships anyway. Headless
Chromium walked the whole arc from `file://` — crowd of 102 at day, empty at
dusk, creature lurking at company, one of two exits locked at flight — with
zero network requests and zero console errors, and the same seed twice is
the same night to the inch.

## Phase 25 — The point you meant *(shipped)*

**Every drawing tool in this editor guessed, and three of them guessed
wrong.**

A fix phase, the first after arc four: `wallrun.js` draws a wall as two
points — landing on a room's ring where it lies along one, or as a
free-standing **wall line** on the new per-storey `floor.walls` — and
`snapgrid.js` gives the drawing grid a ladder of pitches that follows the
zoom, square-held on `S`. The floor tool draws rectangles, the stairs panel
lists every vertical link with select/rotate/nudge/delete buttons (which is
what finally made an elevator deletable), and walk mode works without
Pointer Lock — drag steering, and WASD regardless.

*What fought back:* the free-standing wall wanted to be a room with a
two-point ring, which would have been one line in `shapes.js` and a branch in
every one of the forty modules that walk `shapesOf(floor)` treating each
shape as a room. A separate per-storey array is additive in the save file,
invisible to everything that counts rooms, and reaches the eight places that
actually care about *boundaries* — the renderer, the collider, the plan
sheet, the door leaves, the takeoff (through the plan), the eraser, the door
tool and the session log. Openings on a wall line are pinned to `seg: 0`
precisely so that every consumer that already filters a ring's openings by
segment index needed no new branch at all. *Save:* v12 still, additive —
and the first append that is per *storey* rather than design-wide: a level
with no free-standing wall writes no `walls` key, so every file written
before this build round-trips through it as the same bytes, for the
fifteenth time. *Model:* **Claude Fable 5** — two pure modules, a schema
append, and the collider contract.

## Phase 26 — Take it out again *(shipped)*

**Three sentences of feedback, and every one of them was about a thing the
build could already do and could not be asked to do.**

The eraser became a delete key — one click removes whatever is under it,
whichever tool placed it, while a drag still rubs out floor by the
rectangle; the door and eraser tools' grab tolerance follows the zoom, and
a click that lands on no wall now says so; the walker got its own clock —
real elapsed time spent in fixed 1/60s physics steps, so movement is
proportional to wall-clock time at any frame rate; every way into a walk
arms input (a movement key or a drag arms the fallback, and the arrow keys
are WASD); and a storey can carry a chosen walk start point.

*What fought back:* the eraser's press-or-drag ambiguity. Claiming the
*press* for the object under it is one line and makes the rectangle eraser
unusable along any edge of a room, because rubbing out a block of floor that
starts on a wall is a thing people do constantly. Deferring to the pointer-up
costs a held candidate and a second `pushUndo` — which is free, because
`commit()` diffs and an empty diff pushes nothing. *Save:* v12 still,
additive, and the sixteenth application of the one rule — a storey nobody has
chosen a start point on writes no `spawn` key, so every file written before
this build round-trips through it as the same bytes. The erase, the door,
the window, the pace of a held W and the start point all landed as checks in
`test/tools/run.mjs`, because they are things only a real pointer and a real
keyboard can prove.

### What this arc leaves for a fifth

Four asks stood here at arc four's close: a pure entry point to the report
pipeline, a design history somebody else can read, analyses that answer
with ranges where they only pretend to a number, and the session hardening
a shipped relay made real. Arc five claimed the history (Phase 34); arc six
claimed the entry point (Phase 37) and shipped the ranges (Phase 41); the
session hardening stays open in the backlog, honestly unclaimed.

## Arc five — the living school

Arc four turned to the person handed the result; arc five turned to the
building itself — light that stops at the walls that were drawn to stop it,
a school you can hear between the bells, weather, the first click, surfaces
worth touching, rooms that repeat, and the director's cut. Ranked by
impact, and shipped in that order; Phase 34, the history, is the one phase
of the era still open.

Two decisions stand over the arc and everything after it. **VR is abandoned
as a concept** — no phase here or anywhere later builds a headset path;
`xr.js` survives only until a phase that touches the export finds deleting
it cheaper than carrying it, and that deletion is pre-approved. And **each
phase ships the same way**: the model-naming convention carries forward
from arc four (anything touching the model layer runs on Claude Fable 5;
surface work runs on Claude Opus 5 or Claude Sonnet 5), and a phase is
*finished* only when its branch has become a pull request, the pull request
has merged to main with CI green, and the closing report names the **next
open phase's number and its named model** — so whoever is running the arc
always knows which session to open next without opening this file.

## Phase 27 — Light that stops at walls *(shipped)*

**A troffer shines through the wall its range crosses, and everyone has
agreed not to look.**

Baked light — the largest single jump in visual fidelity the tool had left,
bought entirely off the frame. `bakelight.js` (pure, with its suite)
computes a 2ft illumination field per storey against sightline's occluder
rules — every budgeted fixture cast individually plus one gathered bounce,
banked as directionless daylight *access* and fixture RGB so a mood can
recombine it — off the main thread in `bakeworker.js`, cached packed in
IndexedDB by `bakestore.js` under a key hashing exactly what light depends
on. The renderer multiplies the result into the storey meshes' vertex
colours on every entry into walk mode, any structural edit terminates the
worker, and the export carries the bake behind a second splice marker it
verifies against the design before wearing.

*Save:* none — a bake is a cache keyed on the structure that made it.
*Model:* **Claude Fable 5** — an illumination model, a worker protocol, and
the renderer contract.

*What fought back:* where the brightness comes from. A tint can only
*darken* — it multiplies albedo — so at night a lamplit room has nothing to
multiply: the answer is that wearing a bake swaps the spill's modest flat
fill for a full one (`BAKE_FILL`) and lets the tint carve the darkness in,
which is also why the indoor clusters can stand down without the building
going flat. And the day channel had to stop being the sun: a baked sun
patch is wrong the moment the mood moves the clock, so what is banked is
directionless daylight *access*, recombined against the palette's sun level
per environment write — a mood click re-tints a hundred thousand vertices
in milliseconds and the bake itself never re-runs. Ceilings turned out to
be load-bearing for the trick: they had no vertex colours at all, and a
dark corridor under a bright ceiling reads as a lie, so `ceilMat` grew
white vertex colours that multiply to nothing until a bake has something
darker to say.

## Phase 28 — A school you can hear *(shipped)*

**The simulation knows where every person is. The air has no idea.**

`murmur.js` (pure, with its suite) turns occupancy into air: a lesson as
one teaching voice behind a shut door, cafeteria chatter summed at +3 dB
per doubling of the real headcount, passing-period rush as clustered knots
of walkers, a chatting pair as one source — emitters that *are* sound.js
sources, priced through the same `pathLossRay` and ranked by the same
voice budget as everything else. Room tone now follows the room's own
acoustics record, `paScript` writes a seeded morning announcement the Web
Speech API reads over the PA, and two willing agents stop and talk — the
same seed makes the same friends stop at the same lockers.

*Save:* none. *Model:* **Claude Fable 5** — the emitter derivation and its
routing are occupancy and occlusion math; the announcement copy is the one
line of it any model could write.

*What fought back:* the Web Speech API's one hard wall — synthesized
speech never enters the Web Audio graph, so the announcement's words
cannot literally pass the convolver: the chime and key-click carry the
room's reverb and the voice rides dry over them, and it has to be shown
the door separately on the way out of a walk, because no bus owns it.
"Which room is this person in" wanted to stay cheap: a seated agent's
room is the `goal` it answered the bell to, never a flood fill per head
per tick, and the corridor's walkers are clustered by cell rather than
voiced each — the budget was never going to give forty walkers forty
voices anyway. And the crowd's census turned out to be load-bearing:
two suites (agents, lifts) enumerate every state a person can be in and
assert the sum, and both had to learn the new word before anything else
would pass.

## Phase 29 — Weather *(shipped)*

**The cloud deck is one coverage and one drift everywhere, and nothing has
ever fallen out of it.**

`weather.js`, pure with its suite — a state of kind, intensity and wind,
with every consequence a deterministic number from seed and hour. Rain and
snow fall as GPU particles clipped to the outdoors the renderer already
distinguishes, wet paving darkens and snow deepens as shader blends on
site and roof, rain lands loudest on the top storey through the acoustics'
own cross-slab constant, and overcast, rain and snow sit one click beside
the moods — in the sky panel, photo mode, and the walk export.

*Save:* v12 still, additive — a design with no weather writes no key.
*Model:* **Claude Fable 5** — a pure state module, two shaders, and the
acoustic coupling.

*What fought back:* the temptation to invent a second cross-slab number.
The rain's attenuation *is* `PATH_SLAB` — importing the constant instead of
coining one is what keeps "rain loudest on the top storey" and "a hum
through the ceiling" the same physics, and the suite pins the equality so
the two can never drift apart. Clipping the falling to the outdoors turned
out to already have an owner: `floorSolidAt`, the same question the site
skin asks, sampled once per column at seed time with a stride of margin so
a swaying flake still lands outside the eave — the GPU never has to know
the building exists. Snow's "deterministic from seed and hour" met "deepens
while you watch" without a stored history: depth is a function of the
design's own clock (scrub the hour and the site whitens), and the renderer
eases two shared uniforms toward the derivation so the arrival is watched
rather than snapped. And the weather record needed no handoff to the mixer
at all — audio.js reads `world.weather` off the same state object a mood
click writes, so the rain bed, the glazing leak and the seeded thunder
clock follow the button with no new wire.

## Phase 30 — The first click *(shipped)*

**Phase 19 fixed the first five minutes for the visitor who arrived. The
tool still assumes they arrived with a network, and leave nothing behind.**

The tool became a program: a gallery of three finished schools on the
welcome — recipes, counted facts and thumbnails in `gallery.js`, the
payloads generated into `gallerystock.js` by `tools/make-gallery.mjs` and
proven undrifted by the suite, each card named by `paScript` off the seed
it carries; installable and fully offline, with every decision the service
worker makes a pure function in `offline.js` and `sw.js` reduced to three
listeners (which also closed the backlog's immutable-cache complaint
without moving an import path); a real Save/Save As/Open to `.school`
files through `filestore.js`, autosave demoted to the safety net it always
was; and "Show me" — palette verbs that replay a tool's own gesture with a
ghost cursor via `demo.js`, so the tutorial and the smoke test are one
artifact that cannot rot.

*Save:* none — a `.school` file is the serialization that already exists.
*Model:* **Claude Opus 5** — all of it is surface and platform wiring;
nothing touches the model layer.

*What fought back:* the service worker's one hard wall, which is the same
shape as Phase 28's speech synthesis. A worker that imports a pure module
has to be a *module* worker, and module workers are not a thing every
engine has; there is no build step here to bundle one flat, and the
alternative — a second copy of the routing rules inside a classic `sw.js`,
where nothing can test them — is exactly the failure the conventions
warn about. So the registration is attempted with `{ type: 'module' }`,
a rejection is caught and reported in the palette's offline row, and an
engine without them gets the tool it had before this phase: online,
working, and saying so. The suite pins the arrangement from the other side
— it reads `sw.js` as text and fails if a path rule ever grows in it.
The demo ran into the one browser API that can tell a synthetic pointer
from a real one: `setPointerCapture` throws `NotFoundError` for a
`pointerId` the browser never issued, and every tool in `editor.js` calls
it on the way down. Stubbed for the length of a playback and `delete`d
after — a real hand keeps real capture — rather than softened in
editor.js, where the check is load-bearing for touch. Two smaller ones:
a first draft of `sanitizeName` reserved `[ -<...]` as a *range*, which
runs from space to `<` and eats the digits, so "Room 101" saved as
"Room ---" (the suite's first assertion is now that one); and the welcome's
`let galleryFilled` sat below the block that opens the welcome, which is
fine on every path a seeded harness takes and a TDZ error on the one path
nobody automates — the very first load. The visual pass caught it, which
is the third pass doing precisely the job it was built for.

## Phase 31 — Surfaces worth touching *(shipped)*

**Every wall in the building is flatter than the floor it stands on.**

Procedural relief per grain family (`relief.js` — height fields and their
tangent-space normals as arithmetic rather than canvas, tileable by
construction), glass with physical refraction — frosting *derived* from
what the room behind the pane is, and the transmission pass confined to
photo mode after measurement (see below); signage derived, never placed
(`signage.js`, pure: placards from names and numbers, emissive EXITs
standing over the egress graph's own exit doors, a whole school's plates
one atlas and one draw call); and a seeded crowd wardrobe (`wardrobeOf`)
with a two-beat walk bob. Not one texture downloaded — the house rule that
textures are generated held throughout.

*Save:* none. *Model:* **Claude Opus 5** — render presets, canvas textures
and one small pure reader; surface work by the arc's own rule.

*What fought back:* three things, and each of them was a rule the codebase
had already written down and this phase read too quickly.

The first is the one that would have shipped looking like a placement bug.
Signing a room from *its own* openings signs about half a school — because
**a partition belongs to exactly one of the two rooms it divides**, so a
classroom whose door was recorded on the corridor's ring has no opening of
its own at all. The sample school signed six rooms out of eleven and every
one of the missing five looked like a geometry error. The fix is to collect
every door on the storey from wherever it happens to be recorded, and let
`shapeAt` say which rooms it divides — which is the same convention read the
right way round, and is now the first thing the suite asserts against a real
building. The same rule decides the frosting: a borrowed light is frosted if
*either* room wants privacy, because "the first side with an opinion" is a
coin toss on ring winding.

The second is a rule about phases rather than about code. The wardrobe
started as three more draws inside `makeAgent` — and every draw after them
moved, so a purely cosmetic addition changed where everybody spawned and how
fast they walked. Nothing failed except the one *simulating* test in the
crowd's suite, which found two fewer people had reached their classroom in
ninety seconds; a threshold one person the other side of the line and the
phase would have shipped a silently different school. Appearance now comes
off its own generator seeded from the population's seed and the person's own
id (`wardrobeOf`), and the suite pins the property directly: dressing the
crowd moves nobody. Its companion, `walkBob`, went the other way — the bob is
*written onto the record* by `stepAgents` rather than computed in render.js,
so the renderer keeps reading the crowd and never has to know the formula.

The third was a near-miss of Phase 30's own retrospective. The glazing reads
`mode` while the materials are being built, and `let mode` sat two hundred
lines below them — a TDZ error on the very first load and on no path a
seeded harness takes, which is precisely the mistake that phase had already
made once with `galleryFilled`. It is declared above the materials now, with
the reason written beside it.

And a fourth, which is the one the phase actually got wrong first and is
worth stating at length, because it is the mistake a "surface" phase is most
likely to make again. A transmissive material makes three.js render the whole
scene a second time into a target the pane samples. That was known and written
down here as a cost — and *taken on in the walkthrough anyway*, on the
reasoning that walking is where you look at glass. Then CI went red on
`walk-moves`, a check that does nothing but render walk frames: 122 seconds on
main, over the 180-second ceiling here. Measured on the same software
rasterizer, over a corridor, the answer was not marginal — **547ms a frame
became 1,186ms.** Refraction more than doubled the cost of a walk, on a tool
that runs on phones. (The relief maps, the same view, the same run: 13%. The
expensive half was never the one with eleven new textures in it.)

So refraction went where depth of field already lives, for the reason already
written beside it — *it is a second scene render, so it is paid for only while
a photograph is being composed.* An ordinary walk keeps the blended pane it
has always had, and keeps the one thing that must survive without a
transmission pass: that you can see through a window and not through a frosted
one, which is `blend` in the glazing table and a test of its own. The walk
measures 441ms again. The lesson is not "transmission is expensive" — it is
that a cost written into a comment is not a cost anybody has checked, and the
number took one afternoon script to get.

The panes are `FrontSide` for a related reason: a pane is a closed box, so its
back faces were never visible, and a *DoubleSide* transmissive material makes
the renderer flip `needsUpdate` on it twice a frame to draw its own backside.

## Phase 32 — Rooms that repeat *(shipped)*

**Schools are the most repetitive building type there is, and the tool
cannot repeat anything.**

(So the phase believed when it was scoped; what was actually missing was
narrower — see below.) `section.js`: the room clipboard — geometry,
openings, finishes, props — pasted at the pointer under a live ghost, a
wing stamped by dragging a row at the clipboard's own pitch, the marquee
the shape tool never had, and the storey-wide move that un-strands the
rooms a shrunk sheet left behind (stairs and lifts stand on two storeys at
once, so they stay put and the status line says so). The real inherited
bug was the mirror's: `reverseRing` now flips `hand` and `sw` when it
re-winds a ring, and a mirror flips `sw` once more, so a mirrored door
finally hangs on the mirrored jamb.

*Save:* none — records are copied and moved, never reshaped. *Model:*
**Claude Fable 5** — ring and opening transforms with the hand/sw flip are
exactly the geometry the conventions warn about.

*What fought back:* the phase's own premise, first. "The tool cannot
repeat anything" was true when the sentence was drafted against memory and
false against the tree: Phase 6 had shipped shift-click multi-select,
Ctrl+C/V/D, R and M on whole sections, and this file had forgotten. The
honest scope was found by reading polyedit.js before extending it — the
ghost, the stamp, the marquee, the storey move, and one real bug — and the
lesson is now a convention above: a phase's premise is checked against the
tree, not against this file.

The bug is the one worth the retelling. The conventions have warned since
Phase 6 that `hand` and `sw` are relative to a run's direction — and the
code path those words were written about still got it wrong, for
twenty-six phases, because `reverseRing` renumbered segments and flipped
`t` when a ring re-wound and left `hand` and `sw` alone. Nothing noticed
for so long because rings are normalized at load and stay normalized;
the one operation that re-winds a live ring is the mirror, and nobody had
tested what a mirrored *door* did, only that it survived. Worked through
on paper: a re-wind on its own must be a physical no-op, so it flips both
fields; a reflection reverses handedness, so the mirror owes one more
`sw` flip on top. The net effect on the stored record is that `hand`
flips and `sw` comes back to the value it started with — which is why
"flips both" was half-remembered and wholly wrong, and why the suite now
proves the door *physically* (`doorPhysics`: where the hinge stands,
which side the leaf swings toward) rather than by the stored signs, which
a re-wind legitimately scrambles.

Two smaller fights, both about when to decide. The marquee cannot decide
at the press — a press on a room used to mean "select it", and a box that
refused to start on a room would be useless, since a box around several
rooms usually starts on one. So the press starts a *potential* marquee
and the release decides click from drag, which is the same call the
rectangle eraser already makes for the same reason, and single-click
selection moved to the release with nobody noticing. And the stamp's
count cannot be a number anybody types — the pitch is the clipboard's own
extent rounded out to cells, the count is how far you dragged, and the
anchor is always the first offset, so the degenerate drag is a paste
rather than an error.

The storey move is the one item that refuses part of its own job, on
purpose. A stair or lift stands on two storeys at once; sliding one
storey under it would either tear it off the other or move it somewhere
neither storey expects. So `moveStorey` carries rooms, wall lines and
props, counts the links it left standing, and the status line says so —
never drop what you could not carry: say so.

## Phase 33 — The director's cut *(shipped)*

**A tour moves the camera and does nothing else.**

Tour stops learned the clock — an optional hour eased the short way round
like the angle it is, mood and weather held-and-flipped like a storey
number, two stops of the same weather crossfading so a storm can build —
and a sentence, spoken on arrival through the PA path, never touching
`state.env` while a tour plays. One-click film plays a tour into the
existing MediaRecorder with the UI hidden, drawing its own compositing
canvas so narration rides the clip as burned-in captions — synthesized
speech being the one genuinely uncapturable thing. And Late for Class
re-aims `hunt.js` at a timetable row against `schedule.js`'s own bell
list, in the tool and in the export.

*Save:* the tours record gained optional fields — additive, the cheap kind.
*Model:* **Claude Sonnet 5** — sequencing, capture wiring and a re-skin
over shipped machinery; the one pure bit (a stop schedule and its easing)
is small and tested like anything else.

*What fought back:* the TDZ bug this file has now shipped three times.
`lastMoodKey` — what a tour stop's sky checkbox actually captures — is read
by `envChanged` on every call, and a `let` declared textually below the
function that reads it is exactly the mistake Phase 30 and Phase 31 each
made once; it is declared ahead of it here, with the reason written beside
it, so a fourth phase does not get to rediscover the rule. The other real
snag was believing the recorded clip already excluded the tool chrome —
it does, `captureStream()` never sees the DOM — which meant the actual gap
was narration, not layout: a caption is either burned into the pixels the
recorder reads or it does not exist on the far side of Save As, and no
amount of CSS fixes that. *Next open phase:* **34 — Claude Fable 5** (a
differ over the save format, model-layer by definition).

## Phase 34 — A history somebody else can read

**The file remembers everything and can answer nothing.**

The fifth-arc note asked for this by name: a design has a history somebody
else can read. Autosave holds exactly one past; undo holds one session's;
and the question every real project asks — *what changed since Tuesday* —
has no answer anywhere in the tool.

- [ ] **Named snapshots.** Save a version with a name into IndexedDB
  beside the autosave, thumbnail from the canvas the share card already
  draws.
- [ ] **A timeline.** Browse the snapshots, preview one, restore one —
  restoring is an edit, and undo undoes it.
- [ ] **`designdiff.js`, pure, with its suite.** Two serialized designs
  in; out, sentences a person can read — which rooms appeared, vanished,
  grew or moved, walls and doors and stairs likewise — and a paintable
  overlay set.
- [ ] **The diff on the sheet.** Added in green, removed in red, changed
  in amber, over the blueprint, between any two snapshots; printable,
  because a drawing that changed is a drawing.

*Leans on:* `save-load.js`, `blueprint.js`, `share.js`'s thumbnail.
*Save:* none — snapshots are the save format stored beside itself.
*Model:* **Claude Fable 5** — a differ over the save format is model-layer
by definition.

## Phase 35 — The square you pointed at *(shipped)*

**Phase 25 gave the grid a pitch that follows the zoom, and then let two of
the three tools ignore it.**

The floor tool and the eraser now lay the square the grid is actually
drawing, at whatever pitch the zoom is at — the ladder's floor moved to
2ft, every step above it a whole multiple; the paint raster gained a pitch
that only ever refines (`rasterOf`/`refineRaster` in paint.js, on the
`cellFt` field every save since v1 had carried meaning nothing); and
`gridref.js` gave the grid an *origin* — a reference point clicked on the
tracing image, so a traced plan's own column lines land on the grid — set
before the first floor or wall or not at all, `gridLocked` refusing with a
sentence rather than re-phasing a drawn plan. A gesture became one repaint
(`paintTiles`), which paid for the finer raster and then some.

*Save:* `gridRef` as an append on the timetable's terms, and `cellFt` — in
every file since v1 — finally meaning something.
*Model:* **Claude Fable 5** by the arc-four rule — a new pure module and a
save-format change are both model layer. It ran on **Claude Opus 5**, which
was the session it was asked in and not a reading of this file. Recorded
rather than quietly fixed: the convention is only worth anything if the times
it was missed are in the record too.

*What fought back:* the raster's *phase*, not its pitch. A pitch change is a
subdivision and nothing notices; an origin that is not a whole number of
pitches from the corner means the raster overhangs the sheet by up to one
tile on each edge, `latticeAligned` stops accepting rooms drawn on the old
phase, and the sheet's border stops being a grid line — which is why
`buildSheet` now draws the four edges itself and why the lock exists at all.
The overhang readout was the small honest one: batching the stroke lost the
per-cell "did this square actually change", so it is counted at queue time
against `shapeAt` instead, because "you have just built 400 ft² over
nothing" is a lie when 390 of it was already there. And `traceRegion` had
`CELL` baked into the two lines that turn cells back into feet, which is the
sort of constant that reads as arithmetic until the day it is a parameter.

## Phase 36 — The door slides to the mark *(shipped)*

**The last tool still aiming with a raw click, and the last catalog still
behind a mode wall.**

`snapAlongSeg` (snapgrid.js, pure, with its suite) slides an opening's
centre along its wall to the grid crossings the wall sits on — held to
pitch multiples of distance on a diagonal, where true crossings are
usually empty — and `moveOpening`/`moveLineOpening` re-run `addOpening`'s
jamb clamp and neighbour test without the opening itself. The door tool
became a target: a ghost the width of the opening rides the snapped point,
a press on an existing opening waits four pixels to learn click-toggle
from drag-slide, and snap is a toggle with `Alt` to free one placement.
And 9 opens a searchable whole-catalog picker into your walk-mode hands
(`searchCatalog` in carry.js) — the digit ring stays the quick eight.

*Save:* none — a moved opening is the same three-field record with a
different `t`, and both toggles are session state.
*Model:* **Claude Fable 5** — two new pure functions with suites and a
gesture rewrite are model layer, and this time it ran where the convention
says it should.

*What fought back:* upstream, not the feature. Phase 35 landed while this
was being written and had already given the grid an origin and rebuilt the
floor tool around tiles — so `snapAlongSeg` grew its origin parameter in
the merge rather than after a bug report, which is the cheap time to learn
it. The gesture's one real trap was the shared press: click-remove and
drag-slide start identically, and the four-pixel discrimination is borrowed
from the rectangle eraser rather than invented, because a threshold that
already survived two years of real pointers is worth more than a fresh
guess. The opening hit-test runs on the *raw* projection while the snap is
on, so a door placed off-grid in a free moment stays clickable after the
toggle goes back — the kind of case nobody files a bug for, they just call
the tool flaky.

## Arc six — the design review

Five arcs drew, walked, peopled, priced and handed over a school; nobody
has yet had to sit across a table from it. Arc six builds for the person a
real project cannot avoid — the reviewer: the one who asks for a section,
reads the dimensions off the sheet, checks which code edition the numbers
came from, arrives by bus, and sits in the chair. The phases are **ranked
by impact and the order is the recommendation**; the last is an and-also
for the machine rather than the reviewer, the way arc four ended on play.
Phase 34, above, remains open and unclaimed by this arc — and it is the
arc's natural companion, since a review is exactly the person "what
changed since Tuesday" is for. Nothing here needs a server: every phase
runs entirely in the page.

The arc ships on arc five's terms, unchanged: anything touching the model
layer runs on Claude Fable 5, surface work runs on Claude Opus 5 or Claude
Sonnet 5, every phase below names its model, and a phase is *finished*
only when its pull request has merged to main with CI green and the
closing report names the next open phase's number and its named model.

## Phase 37 — A drawing is a set of sheets *(shipped)*

**The blueprint was one sheet, and a building has never been a plan.**

`elevation.js` (pure, with its suite) projects the model onto a vertical
plane: each storey's visible mass read off the same mask the roof reads,
openings from the same specs the renderer hangs, the roof from `roofPlan`,
the ground from `groundAt` — all of it 2D fills and lines in sheet feet,
each carrying a `depth` and handed over sorted far-to-near, so the drawing
half is a painter's algorithm and a near wing hides a far one with no
hidden-line geometry anywhere. A section is the same projection with a
knife in it: two points laid with the wall tool's own gesture (a
thirteenth tool, on `\`), poché through walls and slabs split around any
opening the plane slices, stairs climbing in risers, openings beyond in
elevation — and the line itself prints on every plan sheet with its flags
and letter, because a section nobody can locate on the plan is only a
picture. `blueprint.js` grew the set: `sheetSet` binds site, plans, four
elevations, every drawn section and the specification in a real set's
order, numbered A-001 to A-601 through the existing title block, one print
dialog for the lot. And the spec sheet's layout became `specLayout` — pure
over an injected text measurer — so the report pipeline renders from a
design with the DOM never asked, and the visual harness now diffs an
elevation, a section and the spec sheet beside the two plans it already
watched.

*Save:* section lines as an additive `sections` record — a drawn cut is a
fact about the drawing and survives a reload to print twice; a design with
none writes no key. *Model:* **Claude Fable 5** — a projection module and
a save append are model layer, and that is where it ran.

*What fought back:* an import cycle, caught by the walk bundle's cycle
check rather than by anything at runtime — `renderSheetCanvas` wanted to
compute the spec it prints, and `blueprint.js → spec.js → rates.js →
timetable.js → takeoff.js → blueprint.js` closed the loop. The fix was the
rule the sheet panels had already set: this module draws readings and
never takes them, so the caller hands the spec in. The other lesson was
the ground line: it reads `groundAt`, the padded field the walker stands
on, so a hill graded against the facade prints level at the threshold —
which looked like a bug for one test run and is the building pad doing its
job; the suite now pins it as a promise. Next in the arc: **Phase 38 — Say
it on the sheet**, named model **Claude Fable 5**; Phase 34 stays open
beside the arc.

## Phase 38 — Say it on the sheet *(shipped)*

**The sheet shows every wall and states not one number.**

The overlay tool can measure, and a measurement evaporates when the tool
changes; the printed plan carries rooms, doors and a title block and not a
single dimension. A drawing nobody can build from is a picture with a
scale bar. The house answer is already decided by the conventions: the
number on a dimension is *derived* from the geometry it points at, never
typed, so the sheet cannot disagree with the model it prints.

- [x] **`annotate.js`, pure, with its suite.** Two records: a dimension —
  two anchor points and an offset, its text computed from the measured
  distance at draw time — and a note: a point, a leader, a sentence.
- [x] **An annotation tool, thin over the module.** Anchors snap through
  `snapgrid.js` (Phase 35's origin honoured), notes drag, Delete removes;
  selection stays in the tool, records go in the file.
- [x] **The sheet draws them.** Extension lines, ticks and text at sheet
  scale, on plans and on sections and elevations alike; the tracing
  overlay joins the print behind a checkbox, closing the backlog's
  "edit-mode only" complaint.
- [x] **Chained dimensions along a run.** Click a wall and get its
  openings and piers dimensioned end to end, read off the opening records
  the leaf hangs from, which already know every jamb.

`annotate.js` holds both records and everything derived from them: the
drawn parts of a dimension (extension lines with the drafting gap and
overshoot, the line, the 45° ticks, where the text sits and *what it
says* — `dimLabel` renders feet-and-inches in exactly one place, so the
plan, the elevations and the status line can never print three spellings
of one length), hit tests for the tool, the chain over `openingSpec`, and
the loader's normalizers. The tool is a fourteenth toolbar entry (on `'`)
with three gestures — dimension, chain, note — plus select/drag/Delete on
anything drawn; its editor face is geometry without text, the number
riding the status line, because the sheet is where an annotation's text
belongs. `computeFloorPlan` grew `dims`/`notes` and its bounds grow to
hold them; the vertical sheets print only the dimensions *parallel to
their plane*, strung in stacked rows below the drawing.

*Save:* additive per-storey `dims` and `notes` records, absent when
empty — the third and fourth per-storey optionals, on `walls`' terms.
*Model:* **Claude Fable 5** — a save append and snap geometry are model
layer, and that is where it ran.

*What fought back:* two things, both about promises rather than pixels.
The round-trip suite caught the byte-identity claim over-reaching:
annotate-then-clean removes the key, but `nextId` has still moved — an id
was taken and given back — so the pin compares the design field-for-field
minus the counter, and the phase record says so rather than pretending
the bytes match. And the elevations forced a scope decision the mantra
made for us: an oblique dimension projected onto a facade would draw a
foreshortened line under an unforeshortened number — the sheet would
disagree with itself — so a vertical sheet prints exactly the dimensions
parallel to its plane and leaves the rest on the plan, and notes stay on
the plan entirely, because a plan point has no height to hang a sentence
at. Next in the arc: **Phase 39 — The school day starts at the curb**,
named model **Claude Fable 5**; Phase 34 stays open beside the arc.

## Phase 39 — The school day starts at the curb *(shipped)*

**Everyone the building holds was teleported into homeroom before the
first bell.**

The crowd was born seated and died at the last bell; the site outside was
scenery with a mesh under it. A school's site is choreography — the bus
loop, the drop-off, the walk in from the corner, four hundred people
through six doors in fifteen minutes — and every piece of machinery it
needed already existed: an outdoor mesh, agents that queue (the lift
taught them), emitters that follow people, a PA with a morning script.

- [x] **The site learns its verbs.** `kind` on a site region — `busloop`,
  `dropoff`, `parking` — as one stored word beside `surf` and `mark`,
  picked on the site panel and placed by `generate.js` (which also grew a
  drop-off lane the plan never had). The curb points it implies are
  *derived*, never stored: `curbPointsFor` lays a loop's bays a bus apart
  and a lot's let-out points along the same aisles `markStalls` stripes,
  in the region's own oriented rectangle, clipped to its ring — so
  re-shaping the asphalt moves the bays with it, the way a court's paint
  has always moved.
- [x] **Arrival and dismissal.** Every person carries a curb (a seeded
  pick over `siteCurbs`, falling back to the public way, or to nothing
  for a sealed building — which keeps the old born-in-homeroom lifecycle
  verbatim) and a minute to reach it, off an `arrivalOf` side generator
  on `wardrobeOf`'s terms so the crowd's own sequence never moved. A new
  `away` state is "the bus hasn't come": no body, no draw, no collisions.
  Before school the building *fills* — placed at the curb, routed across
  the yard to homeroom; after the last bell everyone lingers a seeded few
  minutes, then routes back out to the curb they came in by, because the
  curbs are nodes on the same graph the morning walked in over.
- [x] **Doors queue.** `threshold.js`, pure with its suite: an exterior
  doorway admits inbound at a rate off its *clear* width, credit capped
  at a person and a half, and nobody held past a bound — over it you are
  admitted on borrowed credit, so the door's average rate holds while no
  rule can park a body forever. Outbound spends nothing: a fire drill is
  exactly the drill it was.
- [x] **The air reads it for free.** As predicted, and with not one line
  in `murmur.js`: walkers and queuers already cluster into rush knots
  wherever they stand, so the curb chatters and dies down on its own, and
  pairs still stop to talk on the walk in. The PA's arrival-bell script
  now genuinely fires over a filling building.

*Save:* `kind` on a site region, present only when set — additive, and a
site with no curb writes nothing new. *Model:* **Claude Fable 5** —
outdoor routing, the crowd's lifecycle and a schema append are model
layer, and that is where it ran.

*What fought back:* the doors, three times, and every time the dismissal
found it — the first routes in this building's life that cross several
doorways on their way to somewhere that is not a room, so "being in the
room you were going to is arriving" never rescued them. First the
far-side door waypoint: the near-portal steering aims *just* past the
centre line, closer than the waypoint's own arrival radius, so a body
parked in the leaf's swing three feet short of "arrived" until the door
shut on it and squeezed it back where it came from — fixed in the aim
(once through the plane you head for the waypoint proper), plus one new
rule real people never needed telling: walk clear of a doorway's swing
before you turn. Second the standoff: a walker pressed against a leaf
parked open across its route, each politely holding for the other until
the last bell — `lift.js`'s bounded-holding lesson a third time, in
`openings.js`: a body that is not using a closing door and stands clear
of its shut position does not get to hold it open for good. Third the
patience counters: sliding along that leaf at walking speed counted as
progress and kept resetting the very timer whose flip would have carried
the body round the free end — progress is now measured *toward the aim*,
not as displacement. And one honest concession: the admission gate meters
the waypoint crossing, but a soft crowd can physically squeeze a body
through the opening uncounted — a real crush does that too, and the
stuck-skip at least may no longer jump the gate on purpose. Next in the
arc: **Phase 40 — The chair, not the checklist**, named model **Claude
Fable 5**; Phase 34 stays open beside the arc.

## Phase 40 — The chair, not the checklist *(shipped)*

**The tool can find an accessible route and has never once sat in the
chair.**

"Accessibility stops at routes" — the backlog's own words: no turning
circles, no reach ranges, no counter heights. And the walkthrough, the
tool's best instrument of empathy, has exactly one body. The two gaps are
one phase: the clearance geometry the analysis is missing is precisely
what a seated walker collides with, so build it once and let the report
and the first-person camera cite the same numbers.

- [x] **A seated walkthrough.** `Z` in a walk (a button on the overlay for
  touch, and in the exported walk): the eye drops to 48in, the feet stay
  put, and the body becomes the chair's — 32in across, a half-inch
  threshold up *or* down, 1:12 at most, and a stair refuses the way a wall
  refuses everyone, with the refusal on the HUD as a sentence: *A stair.
  Seated, the ramps and the lift are the way between storeys.* / *A 30 in
  door. A chair needs 32 in clear, which is a 3 ft leaf.* / *Too steep for
  a chair — 1:8, and 1:12 is the most a ramp may climb.* The lift is
  unchanged, because the lift was always the building's answer.
- [x] **Turning circles, measured.** `clearRadiusAt` grows a circle against
  the collider's walls, rails, shaft walls and furniture (exact) and the
  floor's edge, cuts and stair runs (sampled), and `turningAnalysis` asks
  for ADA's 60in at both sides of every doorway the accessible graph kept
  (sliding a little along and out from the wall, since a clearance is a
  rectangle at the door rather than a point), somewhere on the floor of
  every room the route reaches, and — swept along every door-to-door line
  through a corridor, stepping sideways across it for room — 36in wherever
  the route pinches. A failure is painted where it fails: on the minimap
  behind `O`, and on the printed plan behind a new export checkbox, as the
  circle that *does* fit inside the one that was wanted, with the shortfall
  in inches.
- [x] **Reach and heights, read off the props.** `REACH_RULES`, keyed on the
  geometry family a row draws with: counters at 36in (904.4.1), sinks and
  lavatories at 34in (606.3), a fountain's spout at 36in (602.4),
  wall-mounted controls and hooks between 15 and 48in (308), one work
  surface per room between 28 and 34in (902.3), and lockers — a note when
  every bank is the tall kind (225.2.1). Every finding lands with "⌖ Show it
  on the plan" like any other.
- [x] **One contract, two readers.** `clearance.js` owns the door-width
  constants navgraph.js had carried since Phase 7, plus `doorRolls`,
  `rampRolls` and `seatedStep()`; the accessible graph keeps a doorway iff
  `doorRolls` says so and drops a ramp `rampRolls` refuses, and the seated
  walker is refused at a doorway by the *same function*, asked of the
  collider's new doorway records before the jambs get a say. The suite
  proves it the only way that counts: real baked rooms, real leaves, seven
  widths by three leaf kinds, walked and routed, and the answers match.

*Save:* none — every number is derived. *Model:* **Claude Fable 5** — the
collider contract and clearance geometry are model layer, and that is where
it ran.

*What fought back:* the chair, on its first walk, rolled *under* the
stairs. A run's treads are drawn on air over real floor, and a body whose
reach is half an inch never sees a surface a foot up — so it was handed the
slab underneath and went through the flight at floor level. The seated
step now asks what a *standing* walker would be handed at the same spot,
and refuses that. Then the door rule never fired at a pair of open leaves:
they stand proud of the wall by half the opening and stop the body short of
the plane, so a rule that waited for the plane was never asked; it looks a
foot and a half past the body's front edge now, and at a single leaf too,
because a refusal that geometry would also have made is only a *sentence*
if the rule gets there first. Then the grade rule read a 1:8 ramp as 1:10
from the flat floor at its foot; a ramp is judged by its own pitch now, and
only ground is measured. And then the premise met the tree: the first pass
over every generated school reported a hundred door approaches and a
dozen pinches, and every one of them was true — the corridor template stood
its locker banks 1.4ft off each wall with a bench down the middle, and
33in is what was left. The template is fixed (banks on the walls, no bench
in the fairway), `autofurnish` now keeps every floor-standing stamp four
feet clear of every doorway into the room — reading the doors off the
whole storey, since half of them are recorded on the corridor's ring — and
the gallery stock is re-baked. The sample school's two genuine findings
stand: a door onto the 4ft strip beside its mezzanine void, 18in to turn
in, and a stair hall whose open stair leaves 19in between its foot and the
wall, so the chair that reaches the lift's landing cannot reach the south
door from it. Suite 2033 green (thirty new); the tools pass
gained a seated step; two chrome baselines re-recorded on the pinned
Chromium for the overlay's new button and the report's two new rows, the
sheets byte-stable. Next in the arc: **Phase 41 — Numbers that know their
edition**, named model **Claude Fable 5**; Phase 34 stays open beside the
arc.

## Phase 41 — Numbers that know their edition *(shipped)*

**Three code editions are offered and not one of them changes a number.**

Two backlog findings and one closeout ask, claimed together because they
are the same disease: the edition is printed rather than applied, the
common path of egress travel is a constant nothing measures, and the
readers answer with a number where they should answer with a range — "the
model knows what it does not know", in the arc-four closeout's words.

- [x] **Editions as data.** `codes.js`: one table per offered edition —
  occupant load factors, travel, dead-end and common-path limits, width per
  occupant, the exit thresholds, the glazing rule, each with the table it is
  quoted from — selected by the edition the file already stores. Occupancy,
  egress and daylight read their numbers off it (the constants they still
  export are the default edition's, for a caller with no design in hand),
  the code settings moved there with every importer, and the title block
  prints "IBC 2021 applied", which is finally a true sentence.
- [x] **Common path, measured.** `commonpath.js`: from every corner of every
  room, a Dijkstra out over real feet that stops at the first node with two
  separate ways out — two node-disjoint routes to two distinct exits, a
  two-unit flow with node splitting, where a doorway, a stair and a lift are
  one body wide and open floor is not — or at the exit, when the whole walk
  was common. The backlog's constant is retired; the room's number is the
  longest of its corners', held to the edition's 75ft, printed on the code
  panel and in the CSV, and a finding names where the ways part.
- [x] **Ranges where the input is a guess.** `range.js`, and two readers
  that use it: an unnamed room's occupant load is the room counted as the
  emptiest and the fullest thing the edition prices (3–129 for 900 ft²) and
  the building's total carries the sum, with the unnamed room whose naming
  narrows it most named in the finding; a room's reverberation is
  `rt60Low`–`rt60High`, every surface at the absorptive and the reflective
  end of its published band (`ALPHA_BAND`), with the surface whose band is
  widest in sabins named as the input to pin down. A room over the limit
  only at the bad end is a note of its own, not a warning.
- [x] **Worst-first keeps its shape.** The acoustics section sorts by the
  range's bad end; every egress, accessible, daylight, acoustics and
  occupancy finding carries `cite` — "IBC 2021 · Table 1017.2", "ADA 2010 ·
  §404.2.4", "ANSI/ASA S12.60 · §5.3" — printed under the finding in the
  panel and in a column of the CSV, never a number without its provenance.

*Save:* none new — the code edition has lived in the file since the
conventions said it belongs there. *Model:* **Claude Fable 5** — code
factors, graph measurement and range arithmetic are model layer, and that
is where it ran.

*What fought back:* the premise, first. Writing out the three tables in full
is what showed that for a Group E occupancy and the rules this tool applies,
the numbers this codebase has carried since Phase 7 — 250ft, 75ft, 20ft² a
seat, 0.2in a head — are the same in every edition it offers, as far as the
tables here know them; "not one of them changes a number" was a fact about
the code as much as about the tool, and a reviewer with the printed
editions in hand is the one to correct a row. The phase shipped anyway, on
the convention's own terms (checked against the tree, not this file): the
numbers now have a home and a citation, a suite proves a hypothetical
edition moves every reader, and the first real difference is one row. Then
the common path met the sample school: every classroom upstairs came out
over 75ft, and every one was right — one stair, so the storey is common to
the stair hall's door — which is the phase's premise proved by the tool's
own first building. The two-path test also had to decide *what* is one
body wide before it could be written: the mesh puts a gate node at every
seam between two tiles of one room, and a seam is a line two people can
cross a yard apart, so gates and room nodes carry as many paths as want
them and only portals and links are capacity one — the strict reading,
under which two doors from a classroom onto a corridor with one way off it
are one route with a fork in it. Suite 2072 green (thirty-nine
new); the walk template rebuilt by its tool, since occupancy.js and
acoustics.js ride the bundle and now bring `codes.js` and `range.js` with
them; one chrome baseline — the rail's — re-recorded on the pinned Chromium
for the report's new findings and the readout's three new rows, the sheets
byte-stable (the harness prints no code panel; an exported set gets the
new row and the "applied" from `codePanel` like any other).
Next in the arc: **Phase 42 — The boot diet**, named model **Claude Opus
5**; Phase 34 stays open beside the arc.

## Phase 42 — The boot diet

**Most of the tool still loads before the first frame, and the backlog has
already written the diet.**

The and-also, for the machine rather than the reviewer. The lazy-loading
table in the backlog names every pinned module, what pins it, and its
price of freedom; `lazy.js` exists and `generate.js` already proved the
shape. This phase is that table, executed — and by the backlog's own note,
all of it lives in the untested tool/UI layer, so it lands behind
`test/tools/run.mjs` rather than in front of it.

- [ ] **A normalization registry.** `save-load.js` consults a registry
  instead of importing the eight record-owning modules; a record is
  normalized by its owner once the owner is present, exactly once.
- [ ] **Panels go async.** The report tail — `cost`, `spec`, `egress`,
  `daylight`, `utilisation`, `takeoff` — arrives when a panel opens: the
  Generate button's shape, repeated.
- [ ] **Collab on first use.** The session/wire/presence/cloud stack
  builds on the first collaborative gesture instead of at module load,
  retiring the top-level `createRoster()`.
- [ ] **The minimap gets its own plan.** A cache it fills asynchronously,
  so `blueprint.js` unpins from walk mode's every-frame path.
- [ ] **A budget, stated and enforced.** Boot bytes and request count
  measured in the tools pass with a ceiling the suite holds — the walk
  template's 4 MB rule, applied to the tool itself.

*Leans on:* `lazy.js`, the backlog's own table, `test/tools/run.mjs`.
*Save:* none. *Model:* **Claude Opus 5** — the backlog's own verdict:
none of it is hard, all of it is wiring.
