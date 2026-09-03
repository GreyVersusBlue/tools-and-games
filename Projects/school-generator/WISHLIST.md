# School Generator — Feature Wishlist

**Status: every planned phase has shipped — forty-two of them, Phase 34
last, on Claude Fable 5.1 — and no phase is open. The standing backlog is
where the next one is pulled from.**
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
`rates.js` (cost vocabulary) · `csv.js` (Phase 42: the one CSV reader and
the one writer, which used to be six) · `history.js` (an edit as a diff) ·
`records.js` (Phase 42: the optional records on a design and who owns each —
an owner registers itself when it loads, and the loader carries what nobody
has claimed yet) · `save-load.js` (v12, one migration that ever changed a
shape) · `designdiff.js` (Phase 34: what changed between two designs — rooms
by id, then by name; walls, furniture, links, site regions, storeys, the
sheet and every design-wide record — as sentences a person can read and as
marks the sheet paints) · `snapshots.js` (Phase 34: a design's named pasts,
in IndexedDB beside the autosave and never in the file).

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
the smoke test are one artifact) · `lazy.js` (a module fetched the first time
somebody asks — since Phase 42, the generator, the gallery's stock, the
report and its tail, the printable set and the session stack all arrive this
way) · `fragment.js` (Phase 42: the three things a `#` can carry and the one
loop that reads them, so the shell can tell a session link from a share link
without loading the session stack to ask).

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
  state, that is the pass that will tell you. Since Phase 42 it is also where
  the boot is measured — bytes and requests to the first frame, against a
  stated ceiling, and a list of modules that must not be in it — because
  the static import graph says what *could* load and only a browser says
  what did. All three run in CI on every PR
  that touches this directory; the last two need Playwright and are optional
  locally — a machine without a browser loses them, not the suite.
- **What pins a module is the whole graph, not the importer you can see.**
  Phase 42's backlog table said the loader pinned eight modules and the
  minimap pinned the plan builder; both were true and neither was the whole
  story. `main.js` imported all eight itself, so a registry alone freed
  nothing, and `blueprint.js` was pinned four modules deep — `render.js` →
  `signage.js` → `timetable.js` → `takeoff.js` — by a room-number regex and
  a CSV writer. Before cutting an import, walk the graph and simulate the
  cut (thirty lines over the `import` statements); after, measure the boot
  in the browser — `test/tools/run.mjs` prints it on every run.
- **A record's owner registers itself; the loader never imports an owner.**
  `records.js` is the one place a module is allowed a side effect at load —
  `registerRecord('rates', …)` at the foot of rates.js — because it is the
  only way "normalize this once the module that understands it is here" can
  be true without a third party keeping a list. Before the owner arrives the
  record is *carried*: read as it came, written as it came, never looked
  inside. Anything that reads a lazily-owned record off the state normalizes
  on read (`ratesNow`, `phasingOf`), because an undo can put a carried
  record back after its owner has loaded.
- **A lazily loaded module's readers are only reachable from the gesture
  that awaited it.** The cost sheet's forty handlers read `analysis.rates`
  bare; none of them can fire before the sheet opens, and opening it awaits
  the loader. That is the whole contract, and it is stated once at the top
  of the section rather than checked forty times — but the one function a
  debug hook can reach without the gesture (`sessionStart`) checks, with a
  sentence, rather than throwing a TypeError three lines down.
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
- Common path of egress travel is measured (`commonpath.js`, Phase 41), but a
  pair of leaves is one doorway — right — and so is a 12ft cased opening, which
  is arguable; and a stair is a node, so two stairs off one landing count as
  two ways where a plan checker might want them remote from one another.
- Accessibility reaches past routes now (`clearance.js`, Phase 40), but a
  door's manoeuvring clearance is a circle beside the door rather than ADA
  404.2.4's rectangle with its 18in latch-side strip; a pair of doors is judged
  with both leaves open (the code judges it by the active leaf, so the
  lattice's 4ft pair passes here and would not on a plan check); the outside of
  an exterior door is not tested; and knee and toe clearance under a counter is
  not modelled at all.
- The code edition is applied now (`codes.js`, Phase 41), but two things still
  are not: the reduced 0.15/0.2in per occupant a sprinklered building with
  voice alarm may use — the file has no alarm answer — and anything for a Group
  A assembly space inside the school, which the code treats separately.
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
- The campus scheme is always the same shape (front building, quad, row of
  pavilions) where a real one wraps a hillside.
- `autofurnish` keeps stamps four feet from a door since Phase 40, which is
  a circle where the code wants a rectangle with a latch-side strip, and it
  still stamps a stair room's furniture as if the run were floor. The chair
  reports what is left.

**Play**
- A hunt cannot survive a structural edit — hints name rooms that may no
  longer exist.
- A colour variant cannot recolour an imported model; a prop has one paint.
- The crowd cannot shove anything.
- Hands are desktop-only — touch has no Q, and the palette ring belongs on
  the touch HUD beside the joystick it doesn't yet have.

**Light, sound and picture**
- The walk's light respects geometry (the Phase 27 bake casts every fixture
  against sightline's occluders), but **the editor's live path still lights by
  distance alone** — a drafting table wants legible — and props still take the
  flat lift rather than the field, since instanced geometry shares its vertices
  across the storey.
- Transmission loss ~~is one number per situation rather than a ray cast~~
  *(the ray landed in Phase 24 — `pathLossRay` counts sightline's segments
  and the live leaves; the constant survives as the cross-slab and
  no-geometry answer)*, and there are still no early reflections.
- The phone got photo mode and the minimap (and, it turned out, the ability
  to boot at all — a missing element had been a TypeError on every touch
  device); the topbar and the tool panels are still desktop-shaped.

**The room model**
- `floor.walls` (Phase 25) is a boundary that belongs to the storey, and it
  still does not *bound* anything — a wall line drawn across a room does not
  divide it for flood fill, egress or daylight, because it is not part of any
  ring. Draw a room's own boundary and the run lands on the ring instead, which
  is where dividing a room actually happens.
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
- A design's dimensions aren't part of what a scheme generates against — the
  generator always sizes a fresh state from its own plan.
- The eraser still strokes, and still takes whichever boundary is nearest each
  sample. (The wall drag's parallel-segment fix has been moot since Phase 25 —
  there is no wall drag.)
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
- **What is still on the boot path, and why.** Phase 42 took the first diet —
  4117 KB over 121 requests before, 3805 KB over 109 after, against a 4 MB
  ceiling the harness now holds. This is the table the next diet starts from,
  checked against the graph:

  | module | pinned by | what it would take |
  | --- | --- | --- |
  | `three.module.js` (1274 KB, a third of the boot) | everything | a minified or gzipped vendored build — the walk export's note about a quarter of the bytes applies to the tool too |
  | `main.js` + `render.js` (678 KB) | they *are* the boot | the audit's split, now that the tool harness exists to hold it |
  | `agents.js` (85 KB) | `main.js`'s crowd (`stepAgents` per frame), and `hunt.js` (via `render.js`), `murmur.js`, `haunt.js`, `timetable.js` — every one of the four for `rng` alone | `rng` in its own module; the crowd as an object built when the Life panel opens or a walk starts |
  | `timetable.js` (35 KB) | `render.js` via `signage.js`, for `roomNumber`; `main.js`'s Life panel | `roomNumber` beside `nextRoomName` in `shapes.js`; the day tab of the Life panel async |
  | `gltf.js` (29 KB), `hunt.js`, `xr.js`, `models.js` | `render.js` | unchanged: the scene asking for them at the moment it draws one, not at import |
  | `tour.js`, `haunt.js` (37 KB) | `main.js`: the tours panel, and the palette's haunt entry, both read synchronously | the panel async; the palette entry reading `state.haunt` through the registry |
  | `program.js` + `brief.js` (38 KB) | the Generate dialog's bands and schemes, filled at boot | filled on first open, the way the cost sheet's currencies now are |

  Same terms as before: all of it is in the tool/UI layer, so it lands behind
  `test/tools/run.mjs` — whose `boot-budget` check is now the thing that
  fails if any of it is undone.

## The shipped phases

Phases 1–42 are done. **Their records live in `HISTORY.md`** — one paragraph
each for Phases 19–42, keeping the retrospective that says what fought back,
plus the twelve standing-backlog items a named phase closed. Arcs four, five
and six are complete; nothing in this file is a shipped record any more, so
what is left above is the plan.

Two conventions arrived with those arcs and are still in force:

- **Each phase names the Claude model that should run it.** Anything touching
  the model layer — a new pure module, the save format, the collider contract,
  visibility math, the export bundler's module surgery — runs on Claude Fable;
  surface work — DOM wiring, CSS, render presets — runs on Claude Opus. No
  phase has yet been small enough for Haiku, and that is a judgment, not an
  oversight.
- **A phase is *finished* only when** its branch has become a pull request,
  the pull request has merged to `main` with CI green, and the closing report
  names the next open item and its model — so whoever opens the next session
  knows which one to take without reading this file end to end.

One decision stands over everything after arc five: **VR is abandoned as a
concept.** No phase builds a headset path; `xr.js` survives only until a phase
that touches the export finds deleting it cheaper than carrying it, and that
deletion is pre-approved.

The next thing to do is not a phase. Pull from the standing backlog above, and
see `BACKLOG.md` for where this project sits against the rest of the site.
