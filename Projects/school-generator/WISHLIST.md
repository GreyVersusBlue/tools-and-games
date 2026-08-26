# School Generator — Feature Wishlist

Two arcs are finished, and the third has begun. The first — eight phases, from
a single-floor grid editor to a multi-storey, furnished, polygon-roomed
building you can blueprint, save and walk through on desktop or touch. The
second — eleven more, from a real furniture catalog through doors, light,
sound, the site, a living crowd, analysis, the generator that earned the tool
its name, the sharing that took it out of the tab it was drawn in, the nav mesh
that made every number it prints true, and a last one that made the building
fun to be in rather than only accurate to stand in. The third opens with the
one piece of surgery both of the others deferred — **there is one kind of room
now, and it has an id** — and then stops to fix what a session with a real
floor plan found, which is that **the sheet you draw on was a constant**.

**Everything on the first two lists shipped, bar one item: real-time
collaboration, which needs a server and is picked up below.** Twenty-one
phases, 61 modules, ~35,300 lines, 1,084 tests, eleven save-format versions and
no build step.

This document is two things, and the rule for a builder is the same as it has
always been: read the first part before touching anything, and add to the
second part rather than starting a third list.

- **Part one — where the tool stands.** What it is, the architecture that
  emerged, the conventions a new builder has to know before their first edit,
  what the twenty phases shipped, what fought back, and the standing backlog no
  phase has claimed.
- **Part two — arc three.** Five phases, one of them done. Not a spec — a
  scoped list to pull from and refine before beginning each piece.

Each phase used to have its own retrospective here — what shipped, how it
landed, what fought back, what was left. The first nineteen are condensed below
into the parts that are still load-bearing; the long versions are in this
file's own history (`git log -p WISHLIST.md`) if a specific phase ever needs
re-reading.

---

# Part one — where the tool stands

## What it is

A single-page tool at `Projects/school-generator/index.html`. No build step, no
dependencies beyond a vendored three.js, no server. Open the file and it works;
push the file and it is deployed.

It draws a school in plan and walks through it in first person. The plan has
storeys and **rooms** — polygons with ids, drawn free-hand or painted with a
4ft brush — walls that know whether they are exterior, doors that swing,
windows in bands, stairs and ramps and lifts that cut their own openings, a
graded site with hardscape on it, and a roof over the lot. The walkthrough has collision, gravity, doors that open as you approach,
footsteps that take their material from the floor under them, rooms that
reverberate for as long as their own volume says they should, a sun that is in
the right place for the date and latitude, and a school's worth of people
walking to the room their timetable says they should be in.

It also reads what it has drawn. A report answers occupant load, travel
distance to an exit, accessible route, glazing ratio and reverberation time,
worst-first, saying which rule it applied and what it measured — and it will
generate the whole building from a student count and a sentence, three ways,
so the loop is: seed a plan, read the report, move a door, read it again.

## The architecture that emerged

**One pure module per question, one thin tool on top of it, one `node --test`
suite per module.** This is the single most load-bearing habit in the codebase
and every phase has leaned on it. The geometry never touches three.js; the
tools never do geometry.

The model, bottom-up: `grid.js` (the footprint and its storeys, and nothing
else since Phase 12) · `footprint.js` (how big the sheet is, what has to fit on
it, and what growing or shrinking it would do) · `shapes.js` (rooms: rings, holes, per-segment walls, and
the record itself) · `lattice.js` (the 4ft drawing surface, and `bake()`, the
one door out of it) · `paint.js` (the brush, over rooms that own their
outlines) · `props.js` (the object layer and inter-floor links) · `catalog.js`
(every placeable type, as data) · `walls.js` / `openings.js` / `finish.js`
(derived thickness, door leaves and window bands, floor and paint) ·
`stairs.js` (runs, landings, the holes they cut) · `terrain.js` / `site.js` /
`roof.js` (the ground, what is drawn on it, what covers the building) ·
`history.js` (an edit as a diff) · `save-load.js` (v11, and the one migration
that ever changed a shape).

What it derives: `navgraph.js` + `navmesh.js` (the walkable surface as convex
tiles, and the graph over it) · `collide.js` (what stops you, what holds you
up) · `occupancy.js` / `egress.js` / `daylight.js` / `takeoff.js` /
`acoustics.js` / `report.js` (the analysis, none of it stored) ·
`lights.js` / `sky.js` / `sound.js` (which props emit, where the sun is, what
there is to hear) · `shadow.js` (what an upper storey is standing on) ·
`blueprint.js` (the printable sheet) · `minimap.js`.

What it generates: `program.js` (how many rooms of what kind) · `brief.js`
(a sentence read into that program) · `generate.js` (where the rooms go, three
schemes) · `autofurnish.js` + `templates.js` (which layout a room's name asks
for) · `sample.js`.

What it plays: `schedule.js` (the day as five numbers) · `agents.js` (a seeded
population with timetables) · `shove.js` (bump a chair and it scoots) ·
`hunt.js` (eight things hidden on the mesh) · `decor.js` (a season as a
palette).

What it shows and shares: `render.js` (the three.js scene — by far the largest
file) · `audio.js` (the Web Audio graph, held the way `render.js` holds the
three.js one) · `walkthrough.js` / `xr.js` / `touch.js` (three input paths, one
physics) · `gltf.js` + `models.js` (glTF read and written by hand) ·
`share.js` (a design deflated into a URL fragment) · `tour.js` ·
`overlay.js`.

The editor is `editor.js` plus one tool per verb — `polyedit`, `propedit`,
`stairedit`, `templateedit`, `siteedit`, `overlayedit` — each of them thin over
a pure module (`propplace.js` picks and snaps; `shapes.js` does the rings;
`paint.js` does the brush), and `main.js` wires all of it to the DOM.

## Conventions a new builder must know

Read these before the first edit. Every one of them was learned by getting it
wrong.

- **Add a pure module and its test suite together.** No exceptions. It is why
  this codebase stays debuggable at 34,700 lines.
- **There is one kind of room, and it has an id.** A room is a polygon with a
  record: `{ id, name, color, fin, paint, group, load }`. The 4ft lattice is a
  *drawing surface* (lattice.js, paint.js) and nothing else — everything that
  paints, generates or loads goes through `bake()`, and nothing downstream of
  it knows a lattice was ever involved. Anything that wants to name a room from
  outside the file names its id.
- **Save-format changes stay additive**, are validated in `deserialize()`, and
  never rename the autosave key. Unknown content survives; unknown boundaries
  default to *more* solid, not less. Eleven bumps and nobody has lost a design
  — v11 is the only one that changed a shape rather than adding to one, and it
  should be the last that ever needs to.
- **Derive, don't bake.** Stair cuts, guardrails, blueprint symbols, wall
  thickness, collision segments and the nav mesh are all computed on demand.
  Undo, moves and deletes need no special cases because nothing mutates
  neighbouring data.
- **Every boundary kind blocks the walker and bounds flood-fill by default.**
  New kinds opt *out* of solidity, never in.
- **Prop geometry builders return one merged, vertex-coloured
  `BufferGeometry`,** bottom at y=0, facing +Z, sized from the catalog row.
  Keep that contract and instancing keeps working. One shared material;
  colours are baked per vertex, and since Phase 11 the cache key is the type
  *and* the paint.
- **The sheet starts at the origin and grows +x and +z.** Every rasterizer,
  `inGrid`, the editor's `cellAt` and the save format all read a cell index
  straight off `floor(ft / CELL)`, so the drawing surface has a size but never
  an origin. Phase 13 made the size settable and deliberately left the origin
  alone; what follows is that fitting the sheet to something is two moves —
  slide the *thing* onto the positive quadrant, then grow the sheet — and that
  growing is always safe while shrinking can clip a room the brush later
  repaints. See `footprint.js`.
- **Selection lives in tools, never in the file.** So does anything that is a
  decision about this editing session rather than about the building: whether
  overhangs are allowed, which decoration pack is open, where a shoved chair
  currently is. The converse is now enforceable and was not before: anything
  that is a fact about the *building* belongs in the file, which is where Phase
  12 sent the occupancy group, the design occupant load, the code edition and
  the sprinkler answer.
- **The walkthrough collider is built once at walk-start.** Editing and
  walking are exclusive; anything that lets the world change mid-walk has to
  invalidate it. Since Phase 6 the crowd owns the colliders when it is running,
  because two colliders for one storey means two sets of door leaves.
- **Ctrl-combos route through `main.js`,** not through the tools' generic key
  handling. Tools only ever see Escape, Delete, Enter and friends.
- **Undo restores a snapshot with `Object.assign`, which only ever adds.** Any
  *optional* record on the state (`terrain`, `site`, `roof`, `life`, `overlay`,
  `models`, `tours`) has to be deleted when the snapshot doesn't have it, or
  undoing past the moment it was first written silently does nothing.
- **A `PlaneGeometry` flattened with `rotateX(-π/2)` has its extents in local X
  and Z.** `scale.set(w, d, 1)` gives a plane one unit deep. Four ghost
  previews were wrong this way for two arcs before anybody noticed.
- **Handing a bare `'#rrggbb'` string to a colour buffer silently writes NaN**,
  which reads back as black and poisons a bloom pass downstream. `coloredGeo`
  normalises; anything new that writes colours must too.
- **`mergeGeometries` refuses to mix indexed and non-indexed geometry.**
  `mergeVertices` welds the non-indexed one. This has now bitten twice, four
  phases apart.
- **The prop rotation convention counter-rotates against section rotation**
  (`rotationY -= φ` when the room turns by φ). Correct, tested, and still the
  least intuitive line in the transform code. Read the comments on
  `rotateShape90` / `rotatePoint90` before touching it.
- **A pure module is only as honest as the state its tests put it in.** Phase
  11 shipped physics that passed every test and did nothing at all in the
  browser, because the tests placed the walker somewhere the walkthrough never
  puts it. Test from the state the caller actually produces — which since Phase
  12 means `test/build.mjs`: a suite draws on a scratch lattice and bakes it,
  exactly as the editor, the generator and the loader do.
- **A partition belongs to exactly one of the two rooms it divides.** Both
  rooms have a boundary there; one builds a wall on it and the other leaves the
  segment open, decided by reading order at bake time. Two rooms that each drew
  their own copy would draw two walls in one place, stop a walker twice and
  count double in the takeoff. Every reader that asks "whose wall is this?"
  gets an owner and a neighbour, and anything that has to be true of *both*
  sides — borrowed light was the one that caught it — has to say so explicitly.
- **`hand` and `sw` are relative to the run, and a run has a direction.** The
  lattice had none: a horizontal edge ran +X and a vertical one +Z, always. A
  ring is wound, so half its segments run the other way, and a door copied onto
  one without flipping both fields hangs on the far jamb and sweeps the other
  half of its own doorway. `bake()` and `paint.js` both correct for it; anything
  else that moves an opening between segments must too.

## The three arcs, in brief

**Arc one — from nothing to a building you can walk through.** Multi-floor
state and the prop layer · polygon rooms with holes · a furniture placement
tool with three-tier snapping · stairs, mezzanines and glass walls · a
walkthrough with collision and gravity · editor polish, templates and
section editing · blueprint export and named save slots · touch and
accessibility.

**Arc two — from a building to a place.**

| # | Phase | What it added | Save |
|---|---|---|---|
| 1 | Prop catalog | ~70 real-scale types, collapsible palette, richer procedural kit | — |
| 2 | Doors & windows | Swinging leaves, window bands, derived wall thickness, floor finish and paint, ramps and lifts | v5 |
| 3 | Light & sky | Solar position, sky palette, emitting props with a clustered budget, a hand-written depth-of-field pass, photo mode | v6 |
| 4 | Sound | Sabine reverberation per room, props that make noise, a voice budget, footsteps that read the floor finish | — |
| 5 | The site | Terrain heightfield, site regions and markings, roofs, and the first tool that edits something that is not a room | v7 |
| 6 | A living school | A portal graph, a bell schedule, and a seeded population that walks to its next class and gets out of your way | v8 |
| 7 | Analysis & rigor | Occupant load, egress, accessible route, daylight, bill of materials, and one report that sorts them worst-first | — |
| 8 | Generation | A student count and a sentence become a whole school; a tracing overlay; the structural shadow | v9 |
| 9 | Sharing | glTF in and out, a design in a URL, recorded camera tours, the minimap, and standing in it at 1:1 in a headset | v10 |
| 10 | Honesty | A nav mesh replacing room-as-hub, two more layout schemes, adjacency in the brief, findings on the minimap | — |
| 11 | Play | Colour variants, decoration packs, furniture that scoots when you walk into it, and a scavenger hunt | — |

**Arc three — the building in use.**

| # | Phase | What it added | Save |
|---|-------|---------------|------|
| 12 | Identity | One kind of room, with an id; the lattice demoted to a drawing surface; a room record; delta undo | v11 |
| 13 | The sheet | A plan you can resize, a tracing image the sheet fits itself to, a grid that is the shape it says it is, and a wall drag that stays on one wall | — |

The two phases that turned out to matter most to everything after them were
**Phase 1**, which shipped first and out of order and which every later phase
leaned on, and **Phase 7**, which put the analysis in front of the generator so
that "generate" had something to be judged by. The one that paid for itself
most obviously was **Phase 10**: measured over the mesh instead of over room
hubs, a generated three-storey high school lost a mean of 9ft of travel
distance per room and 60ft off its worst one — numbers nobody had ever walked.

## What fought back, across twenty-one phases

- **A constant nobody could reach is a limit, not a default, and it took a
  stranger's floor plan to find one.** The drawing surface was 160 x 120ft from
  v1 to Phase 12 because nothing could change it and nothing said it was there;
  worse, the grid drawn under the plan was square while the surface was not, so
  a quarter of what looked like the sheet silently refused the brush. Twelve
  phases of tests, four of them about the lattice, and none of them could catch
  it — the geometry was right, the *number* was a decision nobody had revisited
  and the drawing of it was never compared with it. The lesson Phase 11 already
  taught in a different key: test from the state the caller actually produces,
  and now also *look at what the caller actually sees*.
- **Two room representations was a standing tax, and Phase 12 paid it off.**
  For nineteen phases every shared tool — wall, door, erase, measurement,
  blueprint, collision, mesh — handled both, forever. It was the right trade
  at the time (the lattice really is faster for rectangles) and it was paid on
  every new feature rather than once. Removing it cost 700 lines added against
  1,400 taken away, and the removal is what the three items below are past
  tense about.
- **Rooms have identity now, and it was the blocker under three others.** A
  cell was an index into a flat array, so there was nothing to name when
  something happened to a room. That is what blocked section editing until
  rooms could be promoted, what kept the analysis out of the file, what made
  undo a whole-design clone, and what real-time collaboration was *actually*
  waiting on. One id per room unblocked all four in one phase.
- **The save version is the expensive unit.** Six of arc two's eleven phases
  were shaped in part by the cost of a bump and the wish to spend it once;
  Phase 5 reads the way it does because terrain, site and roof all had to land
  in v7 together. The other five spent none at all, and knowing which of those
  two situations you are in is worth ten minutes at the start of a phase.
- **Pointer Lock and touch don't mix**, so the walkthrough has a full parallel
  input path, sniffed once at load rather than mixed per frame. XR made it
  three paths and one physics, which worked because the physics never learned
  about any of them.
- **Bugs cross module boundaries in a phase's review pass.** Three of Phase
  10's seven findings were bugs one item's tests found in another item's code.
  This is an argument for grouping risky work into one phase and reviewing it
  together, and it is why Phase 10 and Phase 11 were split.
- **Frame rate is part of the contract.** Phase 11 shipped a shove that was
  refused at one frame rate and free at another, because a long frame asks for
  a longer step. Anything that compares a per-frame quantity against a fixed
  distance has this bug waiting in it.
- **A refactor with no new feature in it still needs a test that fails.** Phase
  12's acceptance criterion was "the tests all still pass", and that is exactly
  the criterion a silent regression walks through: every module's own suite
  passed while the fire drill lost a third of the building, because a baked
  door hung on the wrong jamb and no unit test knew which jamb a door should be
  on. What caught it was `agents.test.mjs`, which simulates rather than
  calculates. Keep at least one test per arc that *runs the thing*.
- **Deleting a branch changes an answer somewhere.** Three numbers moved when
  the lattice went, all of them in the direction of the polygon half, and each
  had to be understood before it could be accepted rather than after: borrowed
  light was being credited to one room instead of two, the takeoff was
  subtracting a window's width from its wall's length, and travel distance was
  measured to cell centres rather than to corners. "Both halves agreed" was
  never true; it was only never asked.

## The standing backlog

Everything below was left deliberately, with a reason, by the phase that found
it. Items an arc-three phase picks up are marked with the phase that claims
them; the rest are unclaimed and can ride along with whatever is open.

**Model and geometry**
- Switchback ramps — one straight run means an ADA-compliant ramp is 144ft
  long and rarely placeable indoors.
- An elevator that moves. The car teleports with `E`; there is no ride, no call
  button, and the doors are drawn parked open. → *Phase 15 wants the queue.*
- Curvature isn't stored, so re-bending a wall after a reload starts from its
  chords. Curved walls are chords in the collider too.
- Wall paint is one colour per wall, not per face — splitting it is a renderer
  change, not a model one.
- Vertical collision: the walker is still a circle with no head, so you can
  walk under a stair run. Skipped in both arcs. → *Phase 17.*
- A pitched roof over a curve is a stepped rectangle; a straight skeleton would
  fix it and is a phase of its own.
- Site regions can be restyled and deleted but not re-shaped.
- The mesh is inscribed, not exact — a diagonal wall keeps its stair-step, and
  the walk along it comes out a foot long. Gates are midpoints rather than
  funnels.

**Analysis**
- The discharge route stops at the door: the outdoors is one node. → *Phase 17.*
- No prices, on purpose. → *Phase 16 proposes the honest version.*
- Daylight is a glazing ratio, not a daylight factor — nothing knows about
  orientation, overhangs or room depth.
- Common path of egress travel is a constant that nothing measures.
- Accessibility stops at routes: no turning circles, reach ranges or counter
  heights.
- The report doesn't print. A title-block code panel on the blueprint is its
  natural other half. → *Phase 16.*
- ~~Sprinklered is a checkbox rather than a property of the design~~ — done in
  Phase 12, along with the code edition, the occupancy group and a design
  occupant load. What is *still* a session setting is nothing: every question
  the analysis asks about the building now has somewhere in the file to be
  answered.
- The code edition is printed, not applied. Three editions are offered and none
  of them changes a factor or a limit, because this model's numbers happen not
  to differ between them — which is fine until somebody picks one that does.

**The crowd**
- The timetable is random: nothing balances class sizes, matches subjects to
  rooms, or keeps a cohort together. → *Phase 15.*
- The crowd doesn't know the occupant load the report computed. → *Phase 15.*
- The last fifth of an evacuation is a tail — a few agents work their way out
  of a corner the crowd shuffled them into.
- Nobody carries anything, opens a locker, or talks.

**Generation**
- Three schemes, not four. A campus of separate blocks is the interesting one,
  because it is the first scheme where the building is not one connected
  thing. → *Phase 17.*
- Adjacency cannot move a room into a bigger slot — only same-sized rooms swap,
  so "the band room next to the library" is unachievable when no slot beside
  the library is band-room-shaped. The compact block often cannot honour an
  "away from" rule at all, and says so per rule rather than pass/fail.
- A generated school is furnished before it is checked: `furnishAll` stops at
  the prop cap and nothing asks whether it was hit in the middle of a
  classroom.
- The structural shadow is measured at 4ft, so a wing that oversails by three
  feet doesn't register; a room is refused or allowed wholesale rather than
  clipped.
- The tracing overlay is an edit-mode underlay only — it isn't on the printed
  sheet, and nothing traces it for you.

**Play**
- Nothing is hidden outdoors: the mesh covers rooms, so the hunt stops at the
  walls. → *Phase 17.*
- A hunt cannot survive a structural edit — the hints name rooms that may no
  longer exist, so an edit ends it rather than re-hiding.
- Warmth is a straight line plus a charge per storey, not a route, so a thing
  thirty feet away through a wall reads as hot. Routing it would also turn
  hot-and-cold into a solved maze.
- A colour variant cannot recolour an imported model, and a prop has one paint
  — a second colour is a field on the catalog row, not on the prop.
- The crowd cannot shove anything, and a shove treats a prop as a circle of its
  own half-width, which is why nothing long is flagged `light`.

**Light, sound and picture**
- The generic ceiling troffers don't emit; no shadows from the building's own
  lights; `emit.kind: 'spot'` renders as a point; light doesn't respect
  geometry, only distance.
- No moon, no stars, no clouds. The sun study doesn't animate itself.
- Transmission loss is one number per situation rather than a ray cast, and
  there are no early reflections — a room's *shape* has no sound.
- Photo mode and the minimap are both desktop-shaped; neither has been laid out
  for a phone.

**The room model, after Phase 12**
- A boundary that bounds no room cannot be drawn any more, and a pre-v11 file
  that had one loses it. A free-standing garden wall and a wing wall that stops
  halfway across a room are both real things somebody might want; neither is
  something a polygon room can say. The honest fix is a boundary that belongs
  to the *storey* rather than to a room, and it is a schema addition rather
  than a repair.
- The brush refuses a free-drawn room rather than straightening it, which is
  right, and it means a room that has been curved once can never be painted
  again. A "straighten this room back onto the lattice" verb would close the
  loop and is half an hour of work whenever somebody trips over it.
- Painting merges nothing: two rooms sitting against each other with no wall
  between stay two rooms, because merging would silently delete a record. There
  is no *deliberate* merge either — no "join these two rooms" — and now that
  rooms have ids, that is a verb rather than an accident.
- `paint.js` rasterizes every lattice-aligned room on the storey for one cell.
  Fine at school scale and obviously wasteful; the fix is to rasterize only the
  rooms whose bounding box the stroke touches. Phase 13 raised the stakes: the
  scratch lattice is `w * h` cells and the sheet can now be 200 x 200 of them,
  so one brush sample on a large plan allocates forty thousand cells. → *Phase
  17 is where the performance items live.*

**The sheet, after Phase 13**
- The drawing surface has a size but no origin, so a plan cannot extend into
  negative feet — fitting the sheet to something out there moves the *thing*
  instead. Giving it an origin would touch `inGrid`, `cellAt`, every rasterizer
  and the save format, for a drawing nobody has asked to make.
- Shrinking the sheet can strand a lattice-aligned room outside it, where the
  next repaint of that storey clips it. It is named rather than refused, and
  the missing verb underneath is "move everything on this storey by (dx, dz)",
  which would also be the way to make room at the origin end of a plan.
- A design's dimensions are not part of what a scheme generates against: the
  generator sizes a fresh state from its own plan and overwrites whatever was
  there, so "generate into the plan I have drawn" is still not a thing.
- The wall drag's parallel rule is per-stroke and per-tool. The erase tool has
  the same corner problem and deliberately does not take the same fix, because
  a stroke that declines a segment falls through to erasing the floor cell
  underneath it, which would be a worse surprise than the corner.
- The mesh samples every room at 2ft now, where a lattice room used to mesh at
  4ft off cells it already had. Overlaps are prefiltered by bounding box so it
  is not quadratic, but a very large storey does measurably more work than it
  did. → *Phase 17 is where the performance items live.*
- Undo is a diff, and arrays diff by index: splicing a prop out of the middle
  of a long list re-states everything after it. Rooms, props and links are
  appended far more often than inserted, so this is the right trade — and it is
  the first place to look if a delta ever comes out surprisingly large.

**Files and performance**
- glTF textures, PBR materials, skins, morph targets and Draco are each a
  refusal with a sentence attached in `gltf.js`.
- No `EXT_mesh_gpu_instancing` on export, so a furnished school is four
  megabytes rather than a few hundred kilobytes. → *Phase 17.*
- `findPath` sorts an array for its open set. Right at three hundred nodes,
  wrong at three thousand. → *Phase 17.*
- A tour moves the camera and does nothing else — no bell at a stop, no hour
  scrubbed between two, no audio on the recording.
- Cloud saves: the first item that needs a server, and now with a measured
  reason to want one, since a design with a tracing image or imported models
  cannot travel in a link at all. → *Phase 14.*

---

# Part two — Arc three: the building in use

Arc one made a building. Arc two made it real enough to measure and pleasant
enough to stand in. What neither of them did is let anybody *use* it — and the
five phases this arc was planned around share one sentence: **the tool knows
everything about the building except who it is for.** (There are six sections
below: Phase 13 is the one that was not planned, and it is here because using
the tool is how it was found.)

It could not name a room, so nothing outside the file could refer to one and
nobody else could edit one with you. It fills the school with a plausible crowd
rather than this school's crowd. It counts what the building is made of and
refuses to say what that costs. And it stops at its own front door — the site
is scenery, the discharge route ends at the threshold, and every scheme makes
exactly one connected thing.

**Phase 12 is done**, which is the first sentence above in the past tense and
the prerequisite off the front of three of the other four. Phase 17 is
independent of all of them and is the one to reach for when the appetite is for
a self-contained win.

**Phase 13 is done as well, and it was never on either list.** It is what a
walkthrough of the real tool with a real floor plan turned up, and the list is
better for having been interrupted by it — the sentence under it is *the sheet
you draw on was a constant, and the tool never said so*.

## Phase 12 — Identity ✅

**The model could describe a building. It could not refer to one.** Now it can.

- [x] **Every room is a polygon, with an id.** A floor is `{ w, h, shapes }`
  and nothing else. `lattice.js` holds the 4ft raster and `bake()` — one flood
  region becomes one room, collinear runs merge into segments, and every
  opening kind on the lattice becomes an opening at a point along the run it
  sat in. Everything that used to draw on a lattice still does: the generator
  writes into a scratch one per storey, the sample school draws on one, and a
  pre-v11 file is read onto one. All three bake, and nothing downstream knows.
- [x] **A room record.** `{ id, name, color, fin, paint, group, load }`, plus
  `code` on the design — the edition the analysis is quoted from and whether
  the building is sprinklered. The four things Phase 7 said would open a bump
  all landed on that one bump, and the room tool writes the two per-room ones
  the same way it writes a finish.
- [x] **Delta undo.** `history.js` diffs two JSON values and hands back the
  patch. Three strokes of the brush cost 227 bytes of history where they used
  to cost three copies of a ninety-kilobyte building.
- [x] **Save v11, with a migration and a fixture per era.** Five real files in
  `test/fixtures/` — v1, v2, v5, and two v10 designs written by the build
  immediately before this phase — open, migrate, and are checked room by room,
  door by door and square foot by square foot.
- [x] **Delete the second path.** 700 lines of source added against 1,400 taken
  away. `wallSegments`, `floorRooms`, `meshFloor`, `blueprint`, `collide`,
  `egress`, `daylight`, `finish`, `acoustics`, `autofurnish`, `roof`,
  `terrain`, `shadow`, `propplace`, `walkthrough`, `render` and four editors
  each lost their lattice branch.

### What it cost, and what it taught

**The measure of success really was subtraction.** `autofurnish.js` lost the
function that re-flooded a grid region out of a hub because a lattice room had
no outline to ask; `navmesh.js` lost one of its two rasters; `openings.js` lost
its whole grid half. Nothing in the room model is said twice any more, and the
next feature will be written once.

**A refactor whose acceptance criterion is "the tests still pass" is a refactor
that will ship a silent regression.** This one did, and it is worth naming
precisely because the phase's own plan invited it. Every module's suite passed
while a fire drill on the sample school lost a third of the building: a baked
door hung on the far jamb and swept the half of its doorway an off-centre
walker was standing in. The lattice had no winding — a horizontal edge ran +X
and a vertical one +Z, always — so `hand: +1` meant one fixed thing; a ring is
wound and half its segments run the other way. What caught it was the one suite
that *simulates* rather than calculates. Keep one of those per arc.

**Three numbers moved, all toward the polygon half's answer.** Borrowed light
was being credited to one room instead of both sides of the pane. The takeoff
was subtracting a window's width from its wall's linear feet on the lattice and
never on a polygon — a wall's length does not change because there is glass set
into it, so the exterior figure went up by exactly the width of every lattice
window. Travel distance rose by a yard or two because a room is sampled at the
corners of its outline rather than at its cell centres. "Both halves agreed"
was never true; it had only never been asked.

**One thing genuinely cannot survive, and it is stated rather than hidden.** A
boundary that bounds no room — a wall drawn across empty cells, or a stub that
pokes into a room without dividing it — is the one thing the polygon model has
no way to say. `bake()` counts them, `deserialize` hands the count back, and
the status line says how many. Inventing a room to hold one would put floor,
ceiling and occupancy where the design has none. The honest fix is a
storey-level boundary, and it is in the backlog above as an addition rather
than a repair.

**The lazy commit is what let fifteen call sites stay as they were.**
`pushUndo()` no longer pushes: it closes whatever edit was open. A gesture that
changed nothing diffs to nothing and costs no history, which is what
`dropUndo()` was for and is why it is now a no-op nobody has to remember. The
one thing that had to be watched was `canUndo`, which is read on every frame of
a drag: diffing the design to answer it cost more than the edit did, so it is a
tracked flag.

**What it unblocked.** Phase 14's session log has something to name; Phase 15's
timetable has something to bind to that survives a rename; Phase 16's rate
table has a room record to hang a cost on. The `r<floor>:s<id>` node id is
stable for as long as the room is, rather than for as long as its lowest cell
happens to be.

## Phase 13 — The sheet you draw on ✅

**Three things a session with a real floor plan found, and one cause under
two of them.** Not a planned phase: somebody dropped a scan of an actual school
into the tracing overlay, measured it, and hit all three inside a minute.

- [x] **The plan is a size you can set.** `footprint.js` — the sheet, what has
  to fit on it, and the two moves that make a tracing image drawable. Two
  fields in feet in the Floors panel, rounded out to whole 4ft cells, between
  16 and 800ft. The range is not new: `save-load.js` has clamped a loaded
  design to 4–200 cells since v1, so the numbers moved to `grid.js` where the
  loader and the editor both read them, and **no save version was spent** —
  `w` and `h` have been in the file all along and nothing could write them.
- [x] **A measurement fits the plan to the picture.** Measuring is the moment
  an image of unknown size becomes three hundred feet of school, so the fit
  happens there rather than waiting to be asked: the picture slides onto the
  positive quadrant, the sheet grows to cover it, the view re-frames, and it is
  all one undo step with the measurement. Two things it will not do: it never
  shrinks, and it never moves a picture somebody has already traced from —
  every wall drawn over it would come off the line it was traced from. There is
  a Fit button in both panels for asking again later.
- [x] **The grid on screen is the sheet you can draw on.** `THREE.GridHelper`
  is square, so a 40x30 design drew a 160ft *square* of grid lines and the
  bottom quarter of what looked like the drawing surface was ground the brush
  silently refused. Replaced with a rectangle of the real footprint, in three
  weights of line — 4ft cells, a 20ft rule to count by, and a brighter border
  so the edge is a thing you can see rather than a thing you discover.
- [x] **A wall drag stays on one wall.** The wall tool took whichever segment
  was nearest the cursor, which is right for a click and wrong for a drag: run
  along the top of a room, drift a foot past its corner, and the nearest
  segment is the one at right angles. `nearestSegment` now takes a
  `parallelTo` direction and filters the *search* by it, so the stroke finds
  the parallel wall still well within reach instead of refusing. The direction
  rolls from run to run, which is what lets a drag follow a curved wall — a
  curve is chords a few degrees apart, a corner is one step of ninety.
- [x] **The refusals all say something.** Paint off the edge of the sheet and
  the status line names the edge and where to make it bigger; drag a wall round
  a corner and it says the corner was left alone and why. Both were silent, and
  a tool that silently does nothing is indistinguishable from a broken one.

### What it cost, and what it taught

**"I can't put walls in the bottom third" had two causes that look
identical from the chair.** One is the constant: a measured image is three
hundred feet across and the sheet is a hundred and sixty, so the bottom of the
picture is off the drawing surface. The other is a rendering bug that has been
there since Phase 1 and would have bitten with no image at all — `GridHelper`
is square, so a 40 x 30 design drew 160 x 160ft of grid lines over a 160 x
120ft surface, and the bottom quarter of what looked like the sheet was ground
`cellAt` returned null for. Both end the same way: the brush does nothing and
says nothing. Fixing either alone would have left somebody still stuck, which
is the argument for chasing a complaint to its cause rather than to *a* cause.

Nobody hit the second one in twelve phases because every design before this
was drawn outward from the middle of the sheet, and the middle is honest.

**A constant nobody could reach is not a default, it is a limit.** 160 x 120ft
was chosen in v1 as a sensible starting size and read for twenty phases as if
it were one. It was the ceiling on every design the tool has ever made.

**The tolerance on "same wall" is pinned from both sides, and the test says
so.** Below it, the sharpest chord step the arc tessellator produces — 28° on a
wall curved to `MAX_BULGE` — because a drag that follows a curve has to clear
that. Above it, 45°, the shallowest turn anybody draws as a corner. 36° sits
between them, and the suite asserts both bounds rather than the number, so the
day either the tessellation or the rule changes, the failure names itself.

**Growing is safe; shrinking is not, and it says so instead of refusing.** The
brush rasterizes a storey onto a lattice the size of the footprint, so a
lattice-aligned room hanging off the edge comes back from the next repaint
clipped. `atRisk` names those rooms and the status line says how many — the
same register as the overhang refusal, and for the same reason: it is a thing
somebody may mean to do, and the undo is right there. A free-drawn room is
never at risk, because no repaint ever touches one.

**Two panels have shared the left-hand column since Phase 1, and one of them
had been quietly eating the other.** The toolbar reserved a constant for the
floor panel below it, and the floor panel grows with every storey. The twelve
tools had been sliding under it on a laptop screen since Phase 8; the reserve
is measured now.

*Save:* none — see above.

## Phase 14 — Two people, one plan

**The one item on either list that was never built.**

Every arc has named it and every arc has been right to defer it. Phase 9 was
the one that made the reason precise: it is not blocked on a CRDT library, it
is blocked on there being nothing to name. **Phase 12 removed that**, and what
is left is genuinely a networking phase — the first thing in this project that
needs a server, and the second is right beside it.

The honest scope is small. Two teachers round a laptop is the real use; a
design studio with twelve people in it is not what this tool is for.

- [ ] **The design as a log, not a snapshot.** An edit becomes an operation
  against a room id, a prop id or a link id — `move`, `rename`, `restyle`,
  `add`, `remove`. The file stays what it is; the log is what travels. Phase
  12's `history.js` is most of this already: an edit is a patch, both
  directions, and a patch is plain JSON that goes on a wire without the module
  knowing that is what happened to it. What is missing is *addressing* — a
  patch says "floors[0].shapes[4]", where the log needs "room 27".
- [ ] **A conflict rule anybody can predict.** Last-write-wins per record. Two
  people editing one *building* is the whole point; two people editing the same
  room in the same second is rare enough that losing one of the two edits is a
  fair price for a rule that fits in a sentence. No merge UI, no three-way
  anything — if it needs explaining, it is the wrong rule.
- [ ] **Presence.** Whose camera is where, in plan and in the walkthrough. This
  is nearly free — the crowd already draws bodies and the minimap already draws
  a cone of view — and it is most of what makes collaboration *feel* like it is
  working.
- [ ] **Cloud saves**, because the same server does both, and because a design
  with a tracing image or imported models cannot travel in a link at all today
  and says so in a dialog. A saved design becomes a URL that survives the tab.
- [ ] **Offline is the normal case.** The tool works with no network, exactly
  as it does now; a session is something you opt into. Anything that makes the
  file-only path worse is out of scope by construction.

*Leans on:* Phase 12's ids and `history.js`, `save-load.js`'s serializer,
`share.js`;
*collides with:* nothing in the model — this phase adds a transport, and the
strongest sign it is going right is that no geometry module changes.
*Save:* none to the design. A session id and a log live beside the file.

## Phase 15 — A real school day

**The building is full of a plausible school. It has never been full of *this*
school.**

`agents.js` gives every student a room per period that isn't the one they were
just in. Nothing balances class sizes, matches a subject to a room that suits
it, or keeps a cohort together — and Phase 6 said so at the time, and said the
real timetable belonged with the generator because it is the same problem as
laying out the building.

It is also the phase that connects this tool to the rest of the repository it
lives in. `Tools/` already holds a schedule browser, a schedule visualiser and
a seating-chart generator, all of which read a real school's real timetable.
The school generator has never met any of them.

The prize is a question no drawing can answer and this tool nearly can: **does
this building work for this timetable?** Not "how far is it to an exit" but
"how far does 9th grade walk between second and third period, every day, for a
year", and "which four rooms are empty at 10am while the science block is
double-booked".

- [ ] **A real timetable.** Sections, teachers, cohorts and rooms, generated
  from the program the way the building is: a section needs a room of a kind,
  a cohort has to be somewhere every period, and a teacher cannot be in two
  places. Same shape of problem as `generate.js`'s packing, and it should
  report what it could not satisfy rather than quietly fudging it.
- [ ] **Import one.** A CSV out of the schedule tools in `Tools/` binds
  sections to rooms by name — and, now that Phase 12 has shipped, by id, which
  is the difference between a binding that survives a renamed room and one that
  does not. This is the item that makes the whole phase worth doing for somebody who
  already has a timetable and wants to know whether their building suits it.
- [ ] **Utilisation, in the report.** Rooms empty when the school is at
  capacity; rooms over their occupant load; the corridor that carries three
  cohorts at once. All of it is the existing report's shape — a finding, a
  rule, a measurement, worst-first — over a new reading.
- [ ] **The crowd at the real occupant load.** The report works out what the
  building holds, room by room, and `life.students` is still a slider.
  Populating it with exactly what the analysis says is one line, and
  cross-checking the fire drill's stragglers against the travel-distance table
  is the other half of a finding the tool already half has.
- [ ] **Passing-period travel, measured.** The nav mesh made distance honest in
  Phase 10; a timetable is what turns one honest distance into a number about
  the school day. This is the analysis that could not exist before either.
- [ ] **A lift with a queue.** Once the timetable is real, so is the crush at
  the lift between periods, and the teleport-with-doors stops being good
  enough. The car gets a position, a call button and a state machine.

*Leans on:* `schedule.js`, `agents.js`, `program.js`, `report.js`, and Phase
12's room ids for the binding;
*collides with:* the report, which grows a section, and the life panel, which
grows a source.
*Save:* a timetable is a thing about the design and belongs in the file — an
append to v11, not a bump of its own.

## Phase 16 — What it costs

**`takeoff.js` counts what is drawn and stops, on purpose.**

Phase 7 refused to price the building and gave a good reason: unit costs are
local, dated and trade-by-trade, and a tool that guessed at them would be wrong
in a way that looks authoritative. That reasoning is still correct — and it
argues for a specific design rather than for never doing it. **The tool should
not know what a square foot of VCT costs. It should know how to be told.**

- [ ] **A rate table you own.** Editable, dated, sourced, saved *with the
  design* — because the rates that priced this building are part of what the
  price means. Ships empty, with a worked example somebody can overwrite, and
  says loudly what it does not know.
- [ ] **Cost by room, by system and by storey**, with the same worst-first
  treatment the report gives everything else: what the five most expensive
  rooms are, and what is driving each. A number without a decomposition is a
  number nobody can act on.
- [ ] **A spec sheet.** The takeoff says how much VCT; this says *which* VCT.
  Each assembly gets a line — what it is, where it is used, what it is rated
  at — printed with the drawing set rather than living in a panel.
- [ ] **The report prints.** Phase 7's own last item: a title-block code panel
  on the blueprint with occupant load, exits, travel distance and area per
  storey, beside the occupancy tags that phase already put on the plan.
- [ ] **Phasing.** What gets built, and in what order, when the whole thing
  cannot be built at once. A storey, a wing or a scheme's own blocks, each with
  its own takeoff and its own cost — which is the question every real school
  building project actually starts from.

*Leans on:* `takeoff.js`, `report.js`, `blueprint.js`, `finish.js`;
*collides with:* nothing structural. Every number here is a reading of a model
that already exists, which is why this is the safest of the five.
*Save:* the rate table and the phasing belong in the file. Another append.

## Phase 17 — Outward

**The building stops at its own front door.**

Four separate refusals, one cause. Exit discharge ends at the threshold because
`navgraph.js` flattens the whole outdoors into a single node. The scavenger
hunt cannot hide anything on the playing field because the mesh covers rooms
and nothing else. Every layout scheme makes exactly one connected thing. And
the graph gets slow at exactly the size where you would want more than one
building — because `findPath` sorts an array for its open set, which is the
right trade at three hundred nodes and the wrong one at three thousand.

Nothing here was waiting on Phase 12, which makes this the phase to reach for
when what is wanted is a self-contained win.

- [ ] **A mesh over the site.** `navmesh.js` already greedy-meshes a raster into
  convex tiles; the site is a raster — regions, walks, the heightfield. Point
  the same algorithm at it and the outdoors becomes somewhere with real
  distances in it, which is the one change that makes the three items below
  possible rather than merely easier.
- [ ] **Exit discharge, measured to the public way.** The walk from the door to
  the street is what a code actually means by discharge, and it is the finding
  Phase 7 could not make. With a site mesh it is the same Dijkstra over more
  tiles.
- [ ] **The campus scheme.** The fourth `layoutSchool`, and the interesting one:
  the first scheme where the building is not one connected thing. The contract
  it has to meet — `rects`, `links`, `exits`, `footprint`, `entry`, `envelope`,
  `style` — has been deliberately narrow since Phase 8 so that a fourth scheme
  is a fourth function. A covered walk between two blocks is a route over the
  site mesh, which is why this item belongs beside the first one.
- [ ] **A head on the walker.** Skipped in both arcs and fine until now: a
  campus has outdoor stairs and covered walks, and a walker who can stand
  inside a soffit is a walker who will. Vertical collision is a height test on
  the surface function that already exists.
- [ ] **The performance work, all of it at once.** A heap for `findPath`'s open
  set, `EXT_mesh_gpu_instancing` on export so a furnished school is a few
  hundred kilobytes rather than four megabytes, and a look at whether
  generation belongs in a worker. None of these are interesting alone; together
  they are what makes a campus openable.

*Leans on:* `navmesh.js`'s greedy meshing, `site.js`, `terrain.js`,
`generate.js`'s scheme contract;
*collides with:* `navgraph.js`, and therefore every number the tool prints —
so the existing egress and report tests are the acceptance criteria, exactly as
they were for Phase 10's mesh.
*Save:* none. A site mesh is derived, a scheme is transient, and a faster heap
is invisible.

## Suggested build order

**Phase 12 is done**, and doing it first, alone, and reviewing it as its own
phase was the right call for the reason Phase 10 gave: the one regression it
shipped crossed three module boundaries, and a phase with a second thesis in it
would have buried the fire drill that found it.

**Phase 13 is done too**, and it was not on this list at all: it came out of
somebody using the thing. Which is the argument for keeping a phase's worth of
room for whatever a real session turns up, rather than working the list
straight down.

**Now whichever of 14, 15 and 16 the appetite is for.** They do not touch each
other. 15 is the one that makes the tool useful to somebody who already has a
school; 16 is the safest and the most obviously finishable; 14 is the one that
has been on the list longest and the only one that needs infrastructure this
project has never had.

**17 whenever.** It is independent of all of them, it clears six backlog items
between them, and it is the only one of the five that could be started tomorrow
against the code exactly as it stands today.

**On save versions:** Phase 12 spent the expensive one, and spent it on a
shape change rather than an append — which should be the last time that is ever
necessary. Phase 13 changed a design's dimensions without touching the format
at all, because `w` and `h` have been in the file since v1 and the loader has
always read them against the same range the editor now writes. A timetable (15)
and a rate table (16) are appends to v11, which is the Phase 5 lesson (terrain,
site and roof all landed in v7 together) applied deliberately rather than
discovered halfway through.

**On scope:** the honest read of arc two is that the phases that went best were
the ones with a single sentence behind them — Phase 10's "the model knows more
than it says", Phase 7's "a drawing has to survive questions", Phase 12's
"there is one kind of room". Each of the four left has one. If a phase starts
growing a second thesis, that is the signal that it is two phases, which is
exactly how Phase 10 and Phase 11 came to be split, and that split was the
right call both times.

**On refactors, now that one has been done:** a phase whose deliverable is
subtraction needs a test that would fail if the subtraction were wrong, and
"every existing test still passes" is not that test. Phase 12's regression sat
underneath a thousand passing assertions. Whatever the next one is, find the
suite that runs the thing rather than calculating about it, and watch that one.
