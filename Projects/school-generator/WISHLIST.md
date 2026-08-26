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
floor plan found, which is that **the sheet you draw on was a constant**. It
goes on to two people editing one plan, and then to the sentence the whole arc
was named for: **the tool knew everything about the building except who it was
for**, and now it knows that too. It ends by walking out of the front door:
**the site was scenery, and it is now somewhere with distances in it.**

**Everything on both of the first two lists has now shipped.** The last
holdout was real-time collaboration, deferred by every arc for the same good
reason and built in Phase 14 — the client half of it entirely, and the server
half as a contract, because a static site cannot host a relay. Phase 15 then
did the thing arc three was named for: the building is full of *this* school
rather than a plausible one, and the tool will say whether the building suits
it. Phase 16 priced it without ever holding a price, and Phase 17 meshed the
ground around it — which turned out to be one change that lifted four separate
refusals, the fourth layout scheme among them. **Arc three is finished.**

Phase 18 came after it and is not part of it: somebody read this document and
asked whether anything was actually unfinished, and the honest answer was that
three items on the standing backlog had a "still" on them rather than a
reason. The lift the camera teleported past, the one report section that never
reached a sheet, and the server neither contract had. All three are closed,
and the last of them is why the sentence above about a static site is now only
half true — the site is still static, and `server/` is the thing you run
beside it. Twenty-five phases, 78 modules, ~45,200 lines, 1,473 tests, eleven
save-format versions and no build step.

This document is two things, and the rule for a builder is the same as it has
always been: read the first part before touching anything, and add to the
second part rather than starting a third list.

- **Part one — where the tool stands.** What it is, the architecture that
  emerged, the conventions a new builder has to know before their first edit,
  what the twenty phases shipped, what fought back, and the standing backlog no
  phase has claimed.
- **Part two — arc three, and what came after it.** Five phases plus one that
  was not planned, then a sixth that is not part of the arc at all and says so.
  Not a spec — a scoped list to pull from and refine before beginning each
  piece.

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

Since Phase 15 it reads the *school* as well as the building. Give it a
timetable — generated from the rooms it has, or read out of the spreadsheet a
school office already keeps — and it answers the questions no drawing can:
which rooms are empty while the science block is double-booked, which class is
in a room too small for it, how far 9th grade walks between second and third
period every day for a year, and which corridor carries three cohorts at one
bell.

Since Phase 16 it will also say what the building costs — and it holds no
prices to do it. Give it a rate table, dated and sourced and saved with the
design, and it prices what the takeoff already counted: by system, by storey
and room by room, worst first, with what is driving each; it prints a
specification saying which VCT and what this tool does and does not know about
it; it puts the occupant load, the exits and the travel distance in the title
block of every sheet; and it will phase the work, so each stage has its own
takeoff, its own cost and its own place in the running total. Whatever nobody
has priced is counted as zero and said out loud, which is the whole bargain.

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
`rates.js` (what a square foot of something costs, because somebody said so) ·
`history.js` (an edit as a diff) · `save-load.js` (v11, and the one migration
that ever changed a shape).

What it derives: `navgraph.js` + `navmesh.js` (the walkable surface as convex
tiles, and the graph over it) · `collide.js` (what stops you, what holds you
up) · `occupancy.js` / `egress.js` / `daylight.js` / `takeoff.js` /
`acoustics.js` / `utilisation.js` / `cost.js` / `spec.js` / `phasing.js` /
`report.js` (the analysis, none of it stored) ·
`lights.js` / `sky.js` / `sound.js` (which props emit, where the sun is, what
there is to hear) · `shadow.js` (what an upper storey is standing on) ·
`blueprint.js` (the printable sheet) · `minimap.js`.

What it generates: `program.js` (how many rooms of what kind) · `brief.js`
(a sentence read into that program) · `timetable.js` (which class is in which
room in which period, and what would not fit) · `generate.js` (where the rooms go, three
schemes) · `autofurnish.js` + `templates.js` (which layout a room's name asks
for) · `sample.js`.

What it plays: `schedule.js` (the day as five numbers) · `agents.js` (a seeded
population with timetables) · `shove.js` (bump a chair and it scoots) ·
`hunt.js` (eight things hidden on the mesh) · `decor.js` (a season as a
palette) · `lift.js` (a car with a call button, and the queue at its doors).

What it shows and shares: `render.js` (the three.js scene — by far the largest
file) · `audio.js` (the Web Audio graph, held the way `render.js` holds the
three.js one) · `walkthrough.js` / `xr.js` / `touch.js` (three input paths, one
physics) · `gltf.js` + `models.js` (glTF read and written by hand) ·
`share.js` (a design deflated into a URL fragment) · `tour.js` ·
`overlay.js`.

What it shares with another person, all of it added by Phase 14 and none of it
reached by anything else in the tool: `session.js` (a design as records, and
which of two edits to the same record wins) · `presence.js` (who else is here
and where they are standing) · `wire.js` (the pipe — in memory, between the
windows of a browser, or over a relay) · `cloud.js` (a design store, as a
client and a four-endpoint contract). The test for whether this stays clean is
simple: **no module above this paragraph imports any module in it.**

The editor is `editor.js` plus one tool per verb — `polyedit`, `propedit`,
`stairedit`, `templateedit`, `siteedit`, `overlayedit` — each of them thin over
a pure module (`propplace.js` picks and snaps; `shapes.js` does the rings;
`paint.js` does the brush), and `main.js` wires all of it to the DOM.

## Conventions a new builder must know

Read these before the first edit. Every one of them was learned by getting it
wrong.

- **Add a pure module and its test suite together.** No exceptions. It is why
  this codebase stays debuggable at 39,500 lines.
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
- **Anything outside the file that names a room names its id, and keeps the
  name it bound by.** A timetable's section carries `room` (the id, which wins
  and survives a rename) *and* `roomName` (what it was bound by, which is what
  rescues it when the building was redrawn from scratch). Bind by id, then by
  name, then by room number — "104" and "Room 104" are the same room to
  everybody except a string comparison — and never drop what you could not
  bind: report it. See `bindRoom` in `timetable.js`.
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
  *optional* record on the state (`terrain`, `site`, `roof`, `life`,
  `timetable`, `overlay`, `models`, `tours`) has to be deleted when the
  snapshot doesn't have it, or
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
| 14 | Two people | The design as a log of records, last-write-wins per record on a Lamport clock, id blocks, presence, three transports, and a cloud-store client | — |
| 15 | A real school day | A timetable that packs and says what would not fit, a CSV in and out, utilisation and passing-period travel in the report, a crowd that moves in cohorts, and a lift with a queue | v11+ |

The two phases that turned out to matter most to everything after them were
**Phase 1**, which shipped first and out of order and which every later phase
leaned on, and **Phase 7**, which put the analysis in front of the generator so
that "generate" had something to be judged by. The one that paid for itself
most obviously was **Phase 10**: measured over the mesh instead of over room
hubs, a generated three-storey high school lost a mean of 9ft of travel
distance per room and 60ft off its worst one — numbers nobody had ever walked.

## What fought back, across twenty-three phases

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
- **The hard part of collaboration was a counter, not a network.** Phase 14
  went in expecting the transport to be the risk. The transport was three
  small files. What would have shipped broken is `state.nextId`: one counter,
  correct for as long as there was exactly one person, and the reason two
  peers drawing at once would have merged a chair into a corridor. The general
  form is worth carrying forward — before adding a second writer, go looking
  for the state that was quietly single-writer, because it will not announce
  itself.
- **Any rule with "last" in it needs a clock that is not a clock.** Stamping
  edits with `Date.now()` is the obvious reading of last-write-wins and hands
  the building to whichever laptop is fast, permanently and invisibly. A
  counter that only goes up, plus a tie-break, is four lines and buys the
  property that matters: not that the right person wins, but that both screens
  agree about who did.
- **Two numbers with the same units are the hardest kind of bug, because both
  of them are right.** An occupant load says how many people a room may hold; a
  roll says how many children can be given a lesson in one. They are both "how
  many students", they differ by nearly a factor of two, and using the first
  where the second was meant produced a page of findings that were every one of
  them arithmetically true and collectively useless. The fix was never a fudge
  factor: it was giving each number its own function, its own citation and its
  own button. Phase 16 hit the same shape from the other side — the takeoff and
  the estimate both have a number called "glazing" and they are deliberately
  different, because one is priced by the square foot and one by the each. Same
  name, two numbers, and the fix is never to average them.
- **A queue that can hold a door open needs a bound on the holding.** Everybody
  waiting for a lift presses the button on every frame they are not aboard,
  which is what people do — and a car that answers each press, either by
  re-opening or by extending its dwell, never departs at all. It is not a rare
  race: it is the *normal* case the moment more people want the car than fit in
  it, and it took a fixture with the stair deleted to make it happen even once.

## The standing backlog

Everything below was left deliberately, with a reason, by the phase that found
it. Items an arc-three phase picks up are marked with the phase that claims
them; the rest are unclaimed and can ride along with whatever is open.

**Model and geometry**
- Switchback ramps — one straight run means an ADA-compliant ramp is 144ft
  long and rarely placeable indoors.
- ~~An elevator that moves~~ — done in Phase 15 for the crowd and **finished
  in Phase 18** for everybody else. The walkthrough's `E` key calls the car
  rather than teleporting, from the landing as well as from inside the shaft;
  the leaves shut and slide; the cab is one object that is somewhere rather
  than one drawn at each landing. What is still not modelled is a lift with
  more than two stops, and a shaft you can fall down: standing in an empty one
  puts you on the storey's slab, which is what it always did.
- Curvature isn't stored, so re-bending a wall after a reload starts from its
  chords. Curved walls are chords in the collider too.
- Wall paint is one colour per wall, not per face — splitting it is a renderer
  change, not a model one.
- ~~Vertical collision: the walker is still a circle with no head~~ — done in
  Phase 17. Still a circle, and now with a head on it: `overheadAt` is
  `supportAt` looking the other way, and one comparison in `tryStep` against
  the *structure* over you. What is still unmodelled is anything you would
  duck under rather than walk into — a table, a soffit under six feet — and a
  ceiling, which is drawn across the whole storey and which a stair climbs
  through, so it is deliberately not what stops a body.
- A pitched roof over a curve is a stepped rectangle; a straight skeleton would
  fix it and is a phase of its own.
- Site regions can be restyled and deleted but not re-shaped.
- The mesh is inscribed, not exact — a diagonal wall keeps its stair-step, and
  the walk along it comes out a foot long. Gates are midpoints rather than
  funnels.

**Analysis**
- ~~The discharge route stops at the door: the outdoors is one node~~ — done
  in Phase 17. It is measured over `sitemesh.js`'s tiles to the public way,
  and it carries the steepest ground the shortest route out actually crosses.
  What it still cannot say is how *wide* the route is, or whether anything
  stands in it: site props are not obstacles in the mesh.
- ~~No prices, on purpose~~ — done in Phase 16, and still on purpose: the tool
  holds no prices, it holds a dated, sourced rate table somebody types in.
- Daylight is a glazing ratio, not a daylight factor — nothing knows about
  orientation, overhangs or room depth.
- Common path of egress travel is a constant that nothing measures.
- Accessibility stops at routes: no turning circles, reach ranges or counter
  heights.
- ~~The report doesn't print~~ — done in Phase 16, and **finished in Phase 18**:
  `codePanel()` puts occupant load, exits, travel distance and area per storey
  in the title block of every sheet, `dayPanel()` puts the school day under it,
  and the specification prints as a sheet of its own. Every section of the
  report is now on a sheet somewhere. What no sheet says is what a *finding*
  says — the panels carry a verdict and a count, and the findings themselves
  are still only in the report panel and the CSV.
- ~~Sprinklered is a checkbox rather than a property of the design~~ — done in
  Phase 12, along with the code edition, the occupancy group and a design
  occupant load. What is *still* a session setting is nothing: every question
  the analysis asks about the building now has somewhere in the file to be
  answered.
- The code edition is printed, not applied. Three editions are offered and none
  of them changes a factor or a limit, because this model's numbers happen not
  to differ between them — which is fine until somebody picks one that does.

**The crowd**
- ~~The timetable is random~~ — done in Phase 15. What is still random is the
  *fallback*: a design with no timetable in it gets Phase 6's intake, which is
  correct and is the reason every earlier suite still reads the same answer.
- ~~The crowd doesn't know the occupant load the report computed~~ — done in
  Phase 15, and it turned into a distinction rather than a wire: a roll and an
  occupant load answer different questions and now have a rule each.
- An imported timetable has no teachers, because the `Tools/` CSV has no
  teacher column. So "no teacher free" never fires on one, and a real school's
  own staffing is the one thing an import cannot bring with it.
- Lunch is still `pickLunchroom` — the largest common room — rather than a
  sitting the timetable schedules. A school with three lunch periods is a
  school this model draws as one.
- The corridor crush rule is a facilities rule of thumb (10 ft² a head is
  tight, 5 is a crush), not a code limit. Egress width is the code question and
  `egress.js` answers it; nothing reconciles the two.
- The last fifth of an evacuation is a tail — a few agents work their way out
  of a corner the crowd shuffled them into.
- Nobody carries anything, opens a locker, or talks.

**Generation**
- ~~Three schemes, not four~~ — done in Phase 17, and it was the interesting
  one for exactly the stated reason: it is the first scheme where the building
  is not one connected thing, and it could not have been written before the
  site was meshed. What it does not do is *vary* — a campus is always a front
  building, a quadrangle and a row of pavilions, where a real one wraps a
  hillside.
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
- ~~Nothing is hidden outdoors: the mesh covers rooms~~ — done in Phase 17. A
  named site region is a place to hide something, capped at a quarter of the
  hunt so that a nine-acre playing field does not take every slot. Unnamed
  ground is still left out, on purpose: "the south end of the lawn" on a
  nine-acre site is a hunt about wandering.
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
- The generic ceiling troffers don't emit (the twelve-light budget is the
  constraint — see the pool comment in render.js), and no shadows from the
  building's own lights: twelve shadow maps is not a school-scale budget.
  Light still doesn't respect geometry, only distance. `emit.kind: 'spot'`
  is real now — a second fixed pool of four SpotLights, aimed down, driven
  by the same budget with its own cap — so the high bay, the track heads
  and the pole lights throw cones.
- A moon and stars now, on the star-visibility ramp (the moon is the
  anti-solar point, honestly commented — a permanently full moon, no phase,
  no ephemeris). Still no clouds, deliberately: a canvas smear reads worse
  than a clean gradient, and real clouds are a shader project. The sun
  study animates itself — play on the sky panel, an hour a second through
  the same code path the slider drives, stepping hourly under
  prefers-reduced-motion.
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
  did — and since Phase 17 `buildNav` meshes the site as well, which is another
  30–65ms on a big one. Callers that already hold a `terrainField` hand it over
  (`buildNav(state, { siteField })`); the one that matters, `lifeRebuildWorld`,
  does.
- Undo is a diff, and arrays diff by index: splicing a prop out of the middle
  of a long list re-states everything after it. Rooms, props and links are
  appended far more often than inserted, so this is the right trade — and it is
  the first place to look if a delta ever comes out surprisingly large.

**The session, after Phase 14**
- ~~**No server ships.**~~ — done in Phase 18. `server/` is the other half of
  both contracts in one process with no dependencies: the store over HTTP, the
  relay over a WebSocket, and `ws.js` because RFC 6455 without a dependency is
  two hundred lines. `node server/index.mjs` and an address in the Server box
  is the whole of the setup. What is still not shipped is a *deployment* —
  somebody has to run it somewhere, and putting TLS in front of it is the one
  step that is neither in the code nor optional, because a page on `https:`
  cannot call an `http:` store.
- A storey has no id, so adding or removing one is a whole-design resync. On
  the receiving side that replaces the building, which will discard an edit a
  peer had made in the same third of a second. Giving storeys ids is a save
  bump and would close this properly.
- The tracing image and the model library travel **only in a snapshot** —
  at the join, or at a resync. Import a model mid-session and the other person
  does not have it until one of those happens. Both are megabytes, which is
  why they are out of the log; a chunked transfer on its own message kind is
  the honest fix.
- Nothing is acknowledged and nothing is retried. A dropped op is a record
  that is stale until somebody touches it again, and rejoining repairs it.
  Sequence numbers and gap detection are the beginning of a real protocol and
  were deliberately not started.
- **Undo is local, and it wins.** Undoing your own edit re-states the record
  with a newer stamp, so it beats somebody else's later change to that same
  record. It is the conflict rule behaving exactly as written and it is still
  the thing most likely to surprise two people working closely.
- An op carries the whole record, so dragging a vertex of a 200-point
  free-drawn room sends the whole outline. Bounded by the 350ms flush rather
  than by size, and fine at school scale; it is the first thing to measure if
  a session ever feels heavy.
- Whoever runs the relay sees the designs that pass through it, and anybody
  with a store link can read that design. Both are stated in the panel; making
  either private needs accounts, which is a different project.

**Files and performance**
- glTF textures, PBR materials, skins, morph targets and Draco are each a
  refusal with a sentence attached in `gltf.js`.
- ~~No `EXT_mesh_gpu_instancing` on export~~ — done in Phase 17, as a choice
  rather than a policy: a checkbox, on by default, and the expanded file one
  click away for an importer that needs it. A furnished campus goes from 28.3MB
  to 7.7MB. Not the "few hundred kilobytes" this line hoped for, because the
  furniture was never the bulk of it — the *building* is, and getting that down
  wants indexed and quantized attributes rather than an extension.
- ~~`findPath` sorts an array for its open set~~ — done in Phase 17. `heap.js`,
  used by `findPath` and by both multi-source Dijkstras: 1.5x on the A* and
  2.8x on the egress field over a 480-node campus, which is about where the old
  comment predicted the crossover would be.
- A tour moves the camera and does nothing else — no bell at a stop, no hour
  scrubbed between two, no audio on the recording.
- ~~Cloud saves have a client and a contract (Phase 14) and no server.~~ —
  done in Phase 18, and it turned out to be about half a feature after all:
  the four endpoints were an afternoon and the WebSocket under the relay was
  the rest of it. Every copy of the tool is still unconfigured until somebody
  types an address, which is right — a tool that phones somewhere by default
  is a different tool.

---

# Part two — Arc three: the building in use

Arc one made a building. Arc two made it real enough to measure and pleasant
enough to stand in. What neither of them did is let anybody *use* it — and the
five phases this arc was planned around share one sentence: **the tool knows
everything about the building except who it is for.** (There are six sections
below: Phase 13 is the one that was not planned, and it is here because using
the tool is how it was found.)

It could not name a room, so nothing outside the file could refer to one and
nobody else could edit one with you. It filled the school with a plausible
crowd rather than this school's crowd. It counted what the building is made of
and refused to say what that costs. And it stopped at its own front door — the
site was scenery, the discharge route ended at the threshold, and every scheme
made exactly one connected thing. All four sentences are now in the past
tense.

**Phase 12 is done**, which is the first sentence above in the past tense and
the prerequisite off the front of three of the other four. **Phase 14 is done
as well**, and it is the one that cashed Phase 12 in: a room with an id is a
thing two people can edit at once. **Phase 17 is done too**, and it was
independent of all of them exactly as this paragraph said — a self-contained
win, and a bigger one than the list expected, because one mesh over the ground
turned out to be the missing half of four unrelated-looking items.

**Phase 13 is done as well, and it was never on either list.** It is what a
walkthrough of the real tool with a real floor plan turned up, and the list is
better for having been interrupted by it — the sentence under it is *the sheet
you draw on was a constant, and the tool never said so*.

**Phase 15 is done**, and it is the one the arc was named for: the tool now
knows who the building is for. **Phase 16 is done too**, and with it the third
sentence above goes into the past tense: the tool will say what the building
costs, without ever claiming to know a price. **Phase 17 is done**, and with it
the fourth: the building no longer stops at its own front door. **Every phase
this arc was planned around has shipped, and so has the one that wasn't.**

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
timetable has something to bind to that survives a rename; Phase 16's estimate
has a room record to hang a cost on and its phasing plan is a list of those
same ids and nothing else. The `r<floor>:s<id>` node id is
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

## Phase 14 — Two people, one plan ✅

**The one item on either list that was never built.** It is built.

Every arc named it and every arc was right to defer it. Phase 9 made the
reason precise: it was never blocked on a CRDT library, it was blocked on
there being nothing to name. **Phase 12 removed that**, and what was left was
genuinely a networking phase — which turned out to mean four small modules and
not one line of changed geometry.

- [x] **The design as a log, not a snapshot.** `session.js`. An edit is a list
  of **records**: `room 27`, `prop 41`, `design env`, each carrying the whole
  of itself. `opsBetween(before, after)` reads two designs as record maps and
  says what moved; `applyOps` puts them onto a design somewhere else. A room
  that moved storeys is one record, not a delete and an add that can arrive in
  either order. Two fields never travel — `currentFloor` and `nextId` are
  about the person, not the building.
- [x] **A conflict rule anybody can predict.** Last write wins, per record,
  where "last" is a Lamport counter rather than a wall clock — two laptops
  disagree about the time by whole minutes, and a rule built on `Date.now()`
  hands the building to whichever machine is fast. Ties break on site id, so
  two people who saw the same two edits in opposite orders end up with the
  same building. That is the property, and the suite asserts it directly.
- [x] **Ids in blocks.** Not on the original list, and the phase does not work
  without it: `state.nextId` is one counter, so two peers both mint id 27 and
  the log merges a chair into a corridor. A site hashes into one of 4096
  blocks a million ids wide; a clash is one in four thousand, is checked for
  at the join, and the later arrival re-rolls.
- [x] **Presence.** `presence.js`. A peer is a body with a name on it: colour
  hashed from the site id so a reconnection is the same colour on every
  screen, a roster that evicts on a timeout rather than waiting to be told,
  and a send policy that is a foot of travel, three degrees of turn, a change
  of storey or mode, or one heartbeat. Drawn as an arrow on the plan, in the
  walkthrough and on the minimap.
- [x] **A wire with three ends.** `wire.js`. Loopback for the suites;
  `BroadcastChannel` between the windows of one browser, which is the
  wishlist's own use case — two teachers round one laptop — with no server at
  all; and a WebSocket relay for two teachers in two buildings. Five message
  kinds, no acknowledgements, no retries: an op that goes missing is a record
  that is stale until somebody touches it, and a joiner asking for a snapshot
  is the repair mechanism.
- [x] **Cloud saves, as a client and a contract.** `cloud.js`. Four endpoints,
  a design id in the link and a write key that never leaves the browser that
  made it. **The server itself is the one part of this phase that could not be
  built here** — this repository is a static site — so what ships is the half
  that can be: every call, every refusal, and a contract narrow enough to
  implement over a lunch break. Unconfigured, the panel says so in a sentence.
- [x] **Offline is the normal case.** `collab.wire` is null until somebody
  opens a session, every function in the section returns immediately while it
  is, and no save version was spent. A session is a thing you opt into, and
  leaving one changes nothing about the design in front of you.

### What it cost, and what it taught

**The strongest sign it went right is the diff.** Four new modules, one new
panel, and the only edits to existing files are an import block, a session
section in `main.js`, and two lines elsewhere: `onChange` became a named
function so an edit that arrived from somebody else could go through the same
door, and `adoptState` learned not to re-frame the camera. No geometry module
changed, which is exactly what the phase's own plan predicted and the first
time this project has been able to say that about a whole phase.

**A record is the unit, and sending the whole record is what makes the rule
one sentence.** The obvious design is to send `history.js`'s patch — it exists,
it is small, it is already both directions. It is also addressed by *path*,
and a path is a statement about an array index, so two people who both insert
a room produce patches that are individually correct and jointly nonsense. The
moment the unit became "the whole of room 27", the merge stopped needing to
understand anything: newest stamp wins, apply, done. A room outline is a few
hundred bytes. That is the entire cost of not having to write a merge.

**Two people editing one building needed an id allocator before it needed a
network.** This was not on the list and is the item the phase would have
shipped broken without. `nextId` has been a single counter since v1 and it was
right for as long as there was one person. The fix is arithmetic rather than
protocol — hash the site into a block — and it is worth naming because it is
the shape of most collaboration bugs: not the transport, but a piece of state
that was quietly single-writer.

**The clock had to stop being a clock.** The first draft stamped ops with
`Date.now()`, which is the obvious reading of "last write wins" and is wrong
in a way that never shows up in a test: two machines minutes apart hand the
building to whichever one is fast, permanently, and the person losing every
argument has no way to tell. A Lamport counter plus a tie-break on site id is
four lines and gives the property that actually matters — not that the right
person wins, but that **both screens agree about who did**.

**A storey has no id, and that is the one hole Phase 12 left.** Rooms, props,
links and tours are identified; storeys are an array index, and removing one
renumbers everything below it. So adding or removing a storey is not an op at
all: it asks for a resync, and the whole building goes across as a save file.
The same escape hatch covers the other case a log is wrong for — a generated
school is thousands of records, and saying it record by record would be slower
*and* larger than saying it whole. `RESYNC_OPS` is where the log gives up, and
it is the only place it does.

**The mirror has to move before the send.** A transport is free to deliver the
other end's reply synchronously — the loopback one in the suites does — and a
mirror still holding the old design when that reply lands makes the reply's
flush say everything a second time. Found by the integration suite on its
first run, in a code path a browser would have hidden for months, which is the
argument for keeping one suite that simulates rather than calculates.

**What the shell had to decide, and what it must not.** Three things turned
out to belong to `main.js` and nowhere else. An arriving edit **waits while
the pointer is down**, because applying it would close the stroke somebody has
their hand on and split it into two undo steps. Local edits are **flushed
before remote ones are applied**, or an edit made in the last third of a
second is swallowed by the mirror. And somebody else's edit is **not an entry
in your undo stack** — `markClean()` after applying, because undo is for what
you did.

**Anybody with the link can read a cloud design, and the panel says so.** The
security model is two ids: one in the link, one that never leaves the browser
that made the design. That is not accounts and it is not permissions, and
writing it down as a limitation rather than burying it is the only honest way
to ship a store this small.

*Save:* none. A session id and a log live beside the file, and a design that
has never been in a session is byte-identical to one from Phase 13.

## Phase 15 — A real school day ✅

**The building was full of a plausible school. It is now full of *this*
school** — and it will tell you whether the building suits it.

`agents.js` gave every student a room per period that wasn't the one they were
just in. Nothing balanced class sizes, matched a subject to a room that suited
it, or kept a cohort together — and Phase 6 said so at the time, and said the
real timetable belonged with the generator because it is the same problem as
laying out the building. It was right on both counts: `timetable.js` is a
packing with a scarcity, a preference and a report on what it could not
satisfy, which is `generate.js` with rooms and periods where it had rectangles
and a footprint.

It is also the phase that connected this tool to the rest of the repository it
lives in. `Tools/` holds a schedule browser, a schedule visualiser and a
seating-chart generator, all of which read a real school's real timetable in a
CSV of one row per group and one column per period. The school generator now
reads exactly that file.

- [x] **A real timetable.** `timetable.js`. Cohorts sized so they add up to the
  roll, teachers who cannot be in two places, and one section per group per
  period packed into a room of the kind the subject wants — best fit, biggest
  class first, and the starting group rotated by the period so the same cohort
  is not always at the front of the queue. **A school teaches what it has rooms
  for**: a building with no gym does not timetable PE and then file a finding
  about it. `timetableIssues` recomputes, against the building as it stands,
  every way the day does not work — no room, a room that has since been
  deleted, a class bigger than the room's occupant load, a lab subject in a
  room that is not a lab, a section nobody is free to teach, and the three
  kinds of double booking a generated timetable cannot produce and an imported
  one can.
- [x] **Import one.** `importTimetableCSV` reads the `Tools/schedule` template
  — `Name, Grade, Color, Students`, then a column per period — and binds each
  cell **by id first, then by name, then by room number**, which is the
  difference Phase 12 makes: a binding that goes by id survives a rename, and
  the name is what rescues it when the building was redrawn. A blank cell is a
  free period, not an error. Everything it could not bind comes back beside the
  timetable and is printed, because an import that silently loses four rooms
  answers a question about a school that is not the one in the file.
  `timetableCSV` writes it back out in the same shape, and the suite
  round-trips a generated day through a spreadsheet and back.
- [x] **Utilisation, in the report.** `utilisation.js`, as a section with the
  same shape as every other — a finding, a rule, a measurement, worst-first.
  Room-periods filled over room-periods available; which rooms stand empty in
  the period the school is fullest; every class in a room smaller than its
  occupant load; and the low-utilisation note that says a building is working
  two days a week.
- [x] **The crowd at the real occupant load.** `crowdSize` — and the one line
  it took is not the interesting part. **The building holds two different
  numbers that both look like "how many students"** and using one where the
  other was meant is the whole of what this item was about: the ⚖ button
  under the slider sets the roll to the occupant load of every classroom, lab
  and studio (teaching spaces only — a gym, a cafeteria and an auditorium each
  hold the *same* crowd, and counting all three counts the school four times),
  while a *generated* timetable is sized by `rollFor`, which is `program.js`'s
  own arithmetic run backwards: rooms × class size × utilisation. The fire
  drill's stragglers are cross-checked against the travel-distance table in the
  same breath — the drill readout now says "clear in 2.3× the 41 s the
  travel-distance table implies", which is the other half of a finding Phase 7
  has had half of since it wrote the distances down.
- [x] **Passing-period travel, measured.** Room to room, over Phase 10's mesh,
  for every cohort at every bell: the longest move, the mean, the walk per
  student per day and the miles per year, and the one claim a stopwatch can
  check — **does this group get there before the bell**, at the pace the crowd
  actually walks, against the passing minutes the bell schedule actually
  allows. `corridorLoad` then adds up whose route crosses which corridor at the
  same bell and how many square feet each of those people gets while it
  happens.
- [x] **A lift with a queue.** `lift.js`. A car with a height between its two
  storeys, a call button that remembers which landing pressed it, and five
  states in a ring — idle, opening, open, closing, moving. Agents walk to the
  landing, press, wait, board while there is room, ride, and step out at their
  own floor; a rider is snapped to the car and is not a body anybody can walk
  into, because they are inside a shaft. `ctx.lifts` absent is the Phase 2
  teleport back, verbatim, which is what let every suite that predates this
  keep reading the same answer.

### What it cost, and what it taught

**Three new modules, one new panel block, one save append, and one new function
on the graph.** `timetable.js` (the model, the packing and the CSV),
`utilisation.js` (the reading) and `lift.js` (the car), with a suite each.
`navgraph.js` grew `pathDistance`; `report.js` grew a section and three blocks
of spreadsheet; `agents.js` grew a population built from a plan and the ride
path; `save-load.js` grew a key; `session.js` grew a field so a timetable
travels between two people editing one plan. No geometry module changed.

**The queue at the lift doors was a livelock, and it was a livelock twice.**
Everybody still waiting presses the button on every frame they are not aboard —
which is exactly what people do — so a car that re-opened for each press never
departed, and once that was capped, a car whose *dwell* was extended by each
press never departed either. The first eight people got in, the ninth held the
doors, and the eight inside rode nowhere for the rest of the school day. One
accumulator (`held`, capped at eight seconds) fixes both halves, and the two
caps are the least obvious four lines in the phase. The general shape is worth
naming: **a queue that can hold a door open needs a bound on the holding, and
the bound is not a nicety, it is the difference between a lift and a livelock.**

**The fixture that found it was the one that took the stair away.** In the
sample school a lift costs forty-five feet-equivalent of waiting and the stair
does not, so `findPath` never routes anybody through the car, and a suite built
on that building would have asserted precisely nothing about three hundred
lines of new code. Delete the stair and the floor opening and the lift is the
only way upstairs — a real building, and the state the ride path actually runs
in. This is Phase 11's lesson word for word, four phases later: *a pure module
is only as honest as the state its tests put it in.* It cost one line in a
fixture and it was the whole difference between a tested feature and a feature
that passed its tests.

**Cost is not distance, and the number this phase exists to produce is
distance.** `findPath` optimises `cost`, which has the stair penalty and the
lift's wait folded into it; a passing-period walk quoted in those units would
be a number about nothing. Every edge has carried `dist` beside `cost` since
Phase 10 and nothing had ever needed to add them up, so `pathDistance` is
twelve lines that should have existed for five phases. The suite asserts the
two are *different* on any route with a stair in it, which is the assertion
that fails the day somebody optimises the wrong one.

**`teachingRooms` predates the occupancy table, and it shows.** It filters by
size and name, because when it was written there was nothing else to filter by
— which let a 300 ft² Main Office through as somewhere to hold a maths lesson.
A class in a library or a cafeteria is a real school making do; a class in the
principal's office is the packing having run out of ideas and not said so.
`TEACHABLE` is the list of uses a lesson can go in, read off `classify` rather
than invented, and it is the second time this codebase has fixed something by
deleting a room from a list rather than adding a rule.

**The plan the crowd walks is plain data, on purpose.** `timetable.js` imports
`rng` from `agents.js`, the way `generate.js` and `hunt.js` do, so `agents.js`
cannot import `timetable.js` back. `timetablePlan` hands over two arrays of
room ids and nothing else, and `makePopulation` reads them without ever
learning that a timetable exists — the same split that has kept the crowd
ignorant of the generator since Phase 8. A cycle avoided by making the
interface smaller is a better outcome than a cycle resolved.

**A free period is spent where you were, not nowhere.** The first plan left a
gap as null, and an agent with a null goal stands still — in a corridor,
because that is where the bell caught them. Filling forward from the last real
room is one line and is the difference between a school and a car park.

**Sizing the day is where "generate" and "analyse" disagree in public.** The
first draft sized a generated timetable from the occupant load, produced
seventeen cohorts for a building with eleven teaching rooms, and filed
thirty-five findings about sections with nowhere to be. Every one of them was
arithmetically true and the page was useless. The fix was not a fudge factor:
it was noticing that a roll and an occupant load answer different questions,
giving each its own rule with its own citation, and putting them behind
different buttons.

**What is left.** The car has a position, a state machine and a queue in the
model, and the shaft's door leaves are still drawn parked open in `render.js` —
animating them is a renderer change, it is the one part of the item with no
headless test, and shipping unverifiable render code is worse than a door that
does not move. The walkthrough's own `E` key still teleports; only the crowd
queues. An imported timetable has no teachers, because the `Tools/` template
has no teacher column, so the "no teacher free" check stays quiet on one — real
and worth saying rather than papering over. Lunch is still `pickLunchroom`
rather than a timetabled sitting. And a section is not something you can drag:
a timetable is generated, imported or cleared, which is why it travels as one
record rather than as a list of them.

*Save:* an **append to v11**, exactly as this list predicted — `timetable`, and
a design that has never been given one writes no key at all, so every file
written before this phase round-trips through it as the same bytes. Eleventh
time that rule has been applied and the eleventh time nobody has lost a design.

## Phase 16 — What it costs ✅

**`takeoff.js` counted what is drawn and stopped, on purpose. It now knows how
to be told what that is worth.**

Phase 7 refused to price the building and gave a good reason: unit costs are
local, dated and trade-by-trade, and a tool that guessed at them would be wrong
in a way that looks authoritative. That reasoning has not changed, and it never
argued for never doing it — it argued for a specific design:

> **The tool should not know what a square foot of VCT costs. It should know
> how to be told.**

So there are no prices in this codebase. There is a *vocabulary* of assemblies,
a rate table that lives in the design file, and four readers in front of them.

- [x] **A rate table you own.** `rates.js`. A closed vocabulary of sixty-two
  assemblies — one per floor finish, one per facade material, one per site
  surface, one per catalog category, because "carpet at the price of VCT" is
  exactly the answer a single `finish` row would give — each with a system, a
  unit and a label. Beside it the table itself: currency, date, source, note,
  and a row per assembly carrying its own date and source where they differ.
  **It ships empty.** `exampleRates()` is a worked example whose own `source`
  field reads *"WORKED EXAMPLE — not a quote. Replace with your own numbers."*,
  and `isExampleRates` compares the table to the shipped one row for row so
  every panel, every sheet and the CSV lead with a warning until somebody
  changes a single number. It goes out as a spreadsheet listing *every*
  assembly — a table that only shows the rows you have already filled in is a
  table nobody can finish — and comes back in, saying what it could not read.
- [x] **Cost by room, by system and by storey.** `cost.js`. Every quantity is
  attributed to a room where a room can honestly own it: slab and floor finish
  exactly, partitions and glazing probed for the room on each side and **split
  between them**, doors and windows probed at the opening's midpoint, furniture
  by `shapeAt` on the prop's own position. Worst first, five rooms, each with
  what is driving it — and the drivers' tail is rolled into one row rather than
  truncated, so they still add up to the room. What genuinely is not a room's —
  the roof, the sitework, the stairs, the lift — is left in a named bucket
  rather than smeared over the rooms pro rata, and a finding fires when that
  bucket is over 40% of the money, because at that point the per-room table
  describes less than half of it.
- [x] **A spec sheet.** `spec.js`, and it prints with the drawing set rather
  than living in a panel. Three columns: what it is (the product row out of the
  table it came from), where it is used (the storeys, and the four biggest
  rooms by quantity), and what it is rated at — **and only what this tool
  actually measures**. A floor finish carries the absorption coefficient
  `acoustics.js` already sums. A ramp carries its steepest slope against 1:12.
  A door carries the 32in egress minimum. Everything else says what it does not
  know, in the cell, rather than leaving it blank for a reader to fill in from
  memory: *"0.4 ft — no fire or STC rating known"*.
- [x] **The report prints.** Phase 7's own last item. `codePanel()` in
  `report.js` returns the data and `blueprint.js` draws it — the same split
  `computeFloorPlan` made, so the module that knows the numbers has no canvas
  in it. Occupant load, building area, exits against the number required, exit
  capacity against the load, longest travel and deepest dead end against their
  limits, then a row per storey with area, load and **the exits that are on
  that storey** — a title block that says "4 exits" on the second-floor sheet
  where there are none is a title block that has been copied rather than read.
  The panel carries the verdict, in red when it fails: a drawing set that
  quietly omits its own analysis is worse than one that has none.
- [x] **Phasing.** `phasing.js`. A phase is an ordered, named set of rooms, and
  that is the whole data model — which covers all three cases the list named,
  because since Phase 12 a storey, a wing and a scheme's own block are all just
  lists of room ids. Each phase gets its own takeoff, its own cost, its own
  £/ft² and the running total a funding schedule is actually written against.
  One phase may *claim* the shared bucket; if none does it stands on its own
  row. Rooms in no phase are listed separately rather than folded in, because a
  plan that quietly drops a wing is worse than one that says it did. And there
  is one buildability check the model can honestly make — **a room cannot be
  built before the room holding it up** — which reads `shapeAt` on the storey
  below at the room's own interior point, and is a `fail`.

### What it cost, and what it taught

**Four new modules, four new suites, one new dialog, two save appends, and no
geometry touched.** `rates.js`, `cost.js`, `spec.js`, `phasing.js`, and 116
tests. `report.js` grew three sections, one exported function and three blocks
of spreadsheet; `blueprint.js` grew a code panel and a sheet of its own;
`save-load.js` grew two keys. Exactly as the list predicted: *every number here
is a reading of a model that already exists, which is why this is the safest of
the five.*

**Zero is a price and null is a silence, and nothing else in the phase matters
as much.** A rate of zero says this costs nothing; no rate at all says nobody
has told us. A reader that conflates them prints a total with a roof missing
and no way to know. So `priced` is a field on every line, unpriced work is
counted as zero *and named*, the finding says the total is "a floor rather than
an estimate", and the CSV prints `no rate` rather than an empty cell.

**The one unrecoverable thing a loader can do is drop somebody's typed-in
number.** `finish.js` drops an unknown finish key, and it is right to: the
fallback is a floor that still exists. Here the fallback is a rate somebody
entered by hand, gone. So `normalizeRates` **keeps** a row whose assembly this
build has never heard of, `costing` ignores it, and `ratesSummary` counts it so
the panel can say "kept, and it prices nothing here". The same rule inverted,
for the same reason both times: *what does the user lose if we are wrong?*

**Two panels printing two different square footages of paint is worse than one
guardrail priced as if somebody rolled it.** `takeoff.js`'s `paintArea`
includes a rail's face, which is not right; matching it exactly was still the
better trade, because the invariant that carries this phase is that the cost's
quantities *are* the takeoff's quantities, checked line by line against the
sample school. The same discipline broke the other way on glazing: the takeoff
folds window area into `glazing`, the estimate cannot (a window is priced by
the each), so they are deliberately different numbers with a comment saying so.
**Same name, two numbers is the bug this codebase keeps finding;** the fix is
never to average them, it is to say which question each one answers.

**The bucket nobody predicted was found by an arithmetic test.** "Every room
plus everything that is nobody's room is the whole estimate" failed on the
sample school by $37,000 — and the reason is that the sample school furnishes
its playground. A bench on the lawn is on a storey and in no room; so is a
24 ft² length of garden wall with open air on both probes. That is not a bug,
it is a third bucket, and it now has a name (`loose`), a number in the summary
and a line in the CSV. **An invariant that fails is worth more than a number
that looks right**, and this one turned a silently-wrong per-room table into a
table that says what it does not cover.

**A wall between two classrooms belongs to both of them, and the probe that
says which two is one `finish.js` already had.** `wallPaint` walks a fixed
distance off the boundary on each side to decide what colour to paint a wall;
`roomsBeside` walks the same distance to decide whose cost it is. One probe,
two questions, and the same answer to both — which is the fourth time this
codebase has bought a property by probing the model instead of storing a field.

**Phasing needed almost no new data, and that is Phase 12's dividend arriving
for the third time.** A phase is a list of `r0:s7` strings. Ids are
*positional* — `p1`, `p2`, assigned on normalize — because a phasing plan is a
short ordered list edited in place, so position already is identity, and a
second allocated identity would have bought an allocator, a save field and a
class of bug (two phases, one id) in exchange for nothing.

**The order check had to be per room, not per storey.** "No phase may contain
an upper storey before a phase containing a lower one" is one line and is wrong
for exactly the building this feature exists for: two wings phased separately,
each built bottom-up, is a perfectly good plan that the storey-granular rule
rejects. Asking `shapeAt` on the storey below, at the room's own interior
point, is the same question `buildingOverhang` asks about the whole footprint —
so a room that overhangs into thin air is already somebody else's finding, and
this one only fires when there really is something underneath being built
later.

**Shipping example numbers at all was the risky decision of the phase.** A
blank sixty-two-row table teaches nobody what a row is for; a filled-in one
that stays filled in is a tool that prints authoritative-looking totals nobody
has checked — which is precisely what Phase 7 refused to build. The resolution
is that the example knows it is the example, by value: `isExampleRates`
compares every key and every rate against the shipped table, so the warning
banner, the report finding and the CSV's `WARNING` row all disappear the moment
one number is typed over, and not before.

**What is left.** No escalation, no location factor, no contingency and no soft
costs — a rate table dated 2026 priced against a building opening in 2029 is
off by whatever inflation did, and this tool does not know. No overhead and
profit line. Nothing is priced by trade, only by assembly, so a table keyed to
a bill of quantities has to be mapped by hand. The shared bucket cannot be
split across phases at all, only claimed whole. The spec sheet names materials
from the design's own tables and has nowhere to put a manufacturer, a series or
a colour — deliberately, because inventing a product name is the same class of
lie as inventing a unit price. And the code panel and the specification sheet
draw on canvas, so like every drawing in this codebase they are exercised by
hand rather than headlessly; what is tested is the data they are handed.

*Save:* **two appends to v11**, exactly as this list predicted — `rates` and
`phasing`. A design nobody has priced writes no `rates` key and a design nobody
has phased writes no `phasing` key, so every file written before this phase
round-trips through it as the same bytes. The twelfth and thirteenth times that
rule has been applied, and the thirteenth time nobody has lost a design.

## Phase 17 — Outward ✅

**The building stopped at its own front door.** It doesn't now.

Four separate refusals, one cause. Exit discharge ended at the threshold
because `navgraph.js` flattened the whole outdoors into a single node. The
scavenger hunt could not hide anything on the playing field because the mesh
covered rooms and nothing else. Every layout scheme made exactly one connected
thing. And the graph got slow at exactly the size where you would want more
than one building.

The cause was a good decision that had expired. Phase 6 wrote it down: *the
site is open ground and Phase 5 gave it a heightfield rather than obstacles, so
routing across it is a straight line and a graph would only add nodes with
nothing to say.* That was true until the ground grew regions with surfaces on
them, a building standing in the middle of it, and slopes steep enough to be
banks. Then it was a raster — and `navmesh.js` has greedy-meshed a raster into
convex tiles since Phase 10.

- [x] **A mesh over the site.** `sitemesh.js`, and it is mostly *not* an
  algorithm: it is the one raster the outdoors makes, handed to `greedyRects`
  and `tileGate`. Not the building, not a planting bed, not a bank steeper than
  25%, and never two surfaces in one tile — the seam between the lawn and the
  car park is a seam rather than a wall, so it is a gate. 8ft cells, because a
  site is fifty times the area of a storey and the finest thing out here is a
  walk between two buildings. Derived, never stored: no `state.yard`, nothing
  in the save file.
- [x] **Exit discharge, measured to the public way.** `dischargeAnalysis` in
  `egress.js` — how far it is over the ground from each door, and *how steep
  the shortest route out actually is*. The public way is the rim of the site,
  walked cell by cell with a node every forty feet, preferring paving where any
  reaches the boundary; `rule` says which of the two happened. A door onto a
  sealed court discharges nowhere and is a `fail`; a route over 1:12 is a
  `fail` and over 1:20 a `warn`, because past 1:20 a walking surface is a ramp
  and a ramp needs handrails, landings and edge protection nothing here draws.
- [x] **The campus scheme.** The fourth `layoutSchool`, and the first where the
  building is not one connected thing: a front building at the street with the
  admin, gym, cafeteria and library, then a quadrangle, then a row (or rows) of
  teaching pavilions, each a double-loaded bar with a stair hall at each end,
  and concrete walks between them. Phase 8's contract held exactly as written.
- [x] **A head on the walker.** `overheadAt` is `supportAt` looking the other
  way, and one comparison in `tryStep`. The walker is still a circle; it just
  has a top now.
- [x] **The performance work, all of it at once.** `heap.js` in `findPath` and
  both multi-source Dijkstras; `EXT_mesh_gpu_instancing` on export, with
  geometries deduplicated across storeys; and a look at the worker, which came
  back "no" with a number attached.

### What it cost, and what it taught

**Two new modules, two new suites, one new scheme, one new checkbox, and no
save version at all.** `sitemesh.js` and `heap.js`, 52 new tests, and — exactly
as this list predicted — *nothing in the file*. A site mesh is derived, a
scheme is transient, and a faster heap is invisible. The eleventh save version
is still the eleventh.

**The reason four unrelated items had one fix is that they were one item
wearing four hats.** This is the third time this codebase has found that shape
— Phase 10's four wishlist entries about travel distance, Phase 12's three
about room identity, and now this. The tell is the same every time: several
findings whose *workarounds* all describe the same missing sentence. Here the
sentence was **the outdoors is somewhere, with distances in it.** Worth saying
out loud because the list itself did not group them: "the discharge stops at
the door" sat under Analysis, "three schemes, not four" under Generation,
"nothing is hidden outdoors" under Play and "findPath sorts an array" under
Performance, and only writing the phase brief put them next to each other.

**The `out` node survived, and that was the load-bearing decision.** The
obvious move was to delete it and let routes end on a tile. Keeping it — and
giving it the meaning it should always have had, *off the property* — is what
made every existing number stay put. Two rules do the work: every way node runs
into `out` **one way only**, so nothing routes *through* the street to get
somewhere else in the school; and `egressField` skips **every** outdoor node
rather than just the hub, which is one comparison generalised. Egress distances
are unmoved by construction rather than by luck, and the existing suites are
the proof this phase was told to look for.

**Real distances made a spine school walk its passing period through the light
courts.** The first working version routed 53 of 70 rooms outdoors — and every
one of those routes was *geometrically correct*, because cutting across a court
between two wings genuinely is shorter than walking up one and down the other.
It is still the wrong answer for a tool that has no idea what the weather is.
The fix is the oldest idiom in `navgraph.js`: `OUTDOOR_COST`, sixty feet a
doorway, charged on `cost` and never on `dist` — the same shape as
`STAIR_COST`, `ELEVATOR_COST` and `FLOOR_PENALTY`, and for the same reason.
Out-and-back has to save two hundred feet before anybody takes it. The three
connected schemes went back to 0 of 70 outdoors; the campus stayed at 55 of 73,
because a campus has nothing to compare the walk with. **A cost that is not a
distance is how this file has always said "yes, but".**

**The head test found a bug in itself twice, and a fire drill found both.** The
first was the wrong hole: a ceiling is cut where the slab *above* it is cut,
not where the slab you are standing on is, and getting it round the other way
put a lid on the stairwell every run climbs through. Half the school stopped on
the fourth tread. The second was subtler and better: with the hole right, the
ceiling *plane* still cut across the lower half of every run, because it is
drawn over the whole storey. So a step is tested against **structure** — a slab
you would walk under, the soffit of a run — and not against a tile grid.
`overheadAt` still reports the ceiling, because that is a true reading of the
model; `tryStep` asks for `structural: true`, because that is what stops a
body. Two honest answers to two different questions, which is the distinction
Phase 15 and Phase 16 each had to make once and this file had to make again.

**The invariant that came out of it is worth more than the feature.**
`stairs.js` has sized the hole a run opens so the run clears `HEADROOM` (6.8ft)
since Phase 4, and a walker is `HEAD_H` (5.9ft) tall. The first number being
the larger one is *why a compliant stair is walkable*, and it was nowhere
written down. It is a test now: walk every run in the sample school and assert
the headroom over the treads. It also caught a real mistake — giving a slab a
foot of thickness overhead, which contradicts `cutStart`'s arithmetic and would
have cost 5.8ft of clearance where the model promises 6.8.

**A hunt sorted honestly by area is a hunt around a car park.** The playing
field is a hundred times the area of the gym, so the area-weighted pool put the
entire site at the front of it and eight of eight things were hidden outdoors.
Capping the outdoor *share* of a hunt at a quarter is the fix, and it is the
right one because it is a statement rather than a fudge: the grounds are part
of the school rather than most of it. Weighting the site down would have been
the fudge — it would have got the same answer from a number nobody could
defend.

**The public way is a line, and modelling it as a place was the first thing
that went wrong.** One node per rim tile put a door forty feet from the kerb
four hundred feet from it, because the outdoors meshes into a handful of
enormous rectangles and the middle of a nine-hundred-foot edge is nowhere near
either end. Walking the rim cell by cell with a node every forty feet is
obvious in hindsight and was not obvious at all. The same class of error, one
level up, is why the *extent* is the site somebody drew rather than the ground
`terrainFor` graded: the heightfield reaches two hundred feet past the building
whether or not anybody asked for a site that big, and taking it as a property
line measures every discharge to a boundary nobody drew.

**"How steep is the route" belongs to the route, not to the search.** The first
version carried a running maximum grade through the Dijkstra, which charged the
steepest cell of a five-hundred-foot lawn to a route that clips one corner of
it. Measuring the line the route actually walks, once, afterwards, is both
cheaper and correct. The general form: *a property of the answer is not always
a property of the search that found it.*

**The campus grows a building where the other three grow a corridor.** Every
scheme before this one absorbs an awkward program by lengthening a run;
`packRuns` is written for exactly that. A campus has no corridor to lengthen,
so the lever is the number of pavilions — pack, and if anything is left over
add a building and pack again. That fell out of the existing helpers rather
than fighting them, which is the clearest evidence that the four-function split
Phase 10 made was the right one.

**Phase 8's contract prediction was exactly right, and it is worth quoting
because so few predictions in this document have been.** *"`rects`, `links`,
`exits`, `footprint`, `entry`, `envelope` and `style`, and that list is the
contract — a fourth scheme is a fourth function against it and no changes
anywhere else."* The campus added one optional key, `walks`, which `buildSite`
reads and no other scheme sets, and changed nothing else in `buildSchool`.
Nine phases is a long time for an interface to hold.

**Two tests had to change, and both were assertions about the world rather than
about the code.** "The three schemes are three different buildings" is now
four. "Every room can be walked to from every other, without going outside" is
now scheme-aware — and it is a *better* test for it, because it asserts the
opposite of itself for the campus and uses `goesOutdoors`, which had to learn
that two doors on one piece of ground are joined directly and a walk can go
outside without visiting a single outdoor node. A test that has to be edited
for a feature is a test that was saying something.

**The numbers, since this phase was half about numbers.** The heap is 1.5x on
`findPath` and 2.8x on `egressField` over a 480-node campus — the crossover the
old comment predicted, arriving roughly where it said it would. Instanced
export takes a furnished campus from 28.3MB to 7.7MB (3.7x without the site,
3.0x with it), and it is declared `extensionsRequired` as well as
`extensionsUsed`, because an importer that silently reads one desk where there
are eight hundred is worse than one that refuses the file. Deduplicating
geometries across storeys by object identity — `getPropGeometry` caches one per
type, so identity is the right test — saved another 3%, which says the
furniture was never the bulk of it.

**The worker: no, and here is the number.** Worst case measured — 2,500
students, two storeys, campus, fully furnished — is 9ms of layout and 213ms of
`buildSchool`, once, behind a button that already shows "Writing…". Moving that
off the main thread costs a duplicated module graph, a structured clone of a
state with 5,545 props in it, and a second copy of every geometry helper the
worker would need; the clone alone is the same order as the work. What is
actually worth 150–270ms per *edit* is `buildNav`, and that is not a job for a
worker either, because everything that asks for it wants the answer in the same
frame. The one real saving was free: `terrainField` is the expensive half of
both `buildNav` and the walker's collider, so `lifeRebuildWorld` builds one and
hands it to both.

**What is left.** Site props are not obstacles in the site mesh, so a discharge
route can walk through a bench. The mesh has no notion of route *width*, so a
four-foot walk and a forty-foot plaza are the same to it. The campus is always
the same campus — a front building, a quad and a row — where a real one wraps a
hillside. There are no covered walkways in the geometry, only paving on the
plan, so the campus's "covered walk" is covered only in the name. Nothing
outdoors casts a soffit except a stair and an overhanging storey. And the head
test blocks a step rather than reporting a finding, so a stair with genuinely
poor headroom is something you cannot walk under rather than something the
report tells you about.

*Save:* **none**, exactly as this list predicted. The first phase since Phase 3
to add nothing to the file, and the reason is the same one `navmesh.js` and
`terrainField` gave: a site mesh is derived, and re-deriving it after an edit
is the whole of keeping it correct.

## Phase 18 — The three that were left ✅

Not a phase by this document's own rule, and worth saying so at the top: a
phase has one sentence behind it, and this has three. What it has instead is a
*question* — somebody read Part one and asked whether anything was actually
unfinished — and the honest answer was that of everything on the standing
backlog, exactly three items were left **incomplete** rather than left
**deliberately**. Every other line up there has a reason attached. These three
had a "still".

**The lift.** Phase 15 built the car — a height, a call button, a state
machine, a queue — because a timetable makes forty people want one at nine
minutes past nine. It built it for the crowd and left the camera teleporting
straight past it, and the backlog said so in two halves. Both are closed.
`lift.js` grows one person's side of a ride: `makeRider`, `pressRider`,
`stepRider`, `cancelRider`, and `liftAtHand`, which answers *which car, and
am I in it* — because pressing the button from the landing rather than from
inside the shaft is the difference between a lift and a teleport you have to
be standing on.

**It is deliberately not shared with agents.js**, and that was the one real
decision in the phase. The two riders want different things from the same car:
an agent has a floor it was routed to and a body that has to keep being
resolved against a crowd while it waits, and a camera has neither. Folding
them together would have produced one function with a steering branch in it,
which is the shape `lift.js` was written to avoid in the first place. Two
riders, one car, and the car is the only thing they share — which is also
literally true when a crowd is running, because the crowd owns the cars and
hands them over, exactly the bargain the colliders struck in Phase 6.

**The renderer half** was the smaller change and the more visible one. The
leaves are their own Groups now, keyed by lift and storey the way door leaves
are keyed by opening, and `poseLifts` reads lift.js's own records and slides
them. The car went with them, and that was not in the item: a cab drawn at
each landing was the same fiction as doors that never shut, invisible for
fifteen phases because you could only ever see into a shaft through open
doors — and visible the instant somebody rides between two storeys and finds
no floor under them. One cab, parked on the lower storey it serves, at
`car.y`.

**The school day on the sheet.** Phase 16 put the report in the title block
and left one section off it, and said which one. `dayPanel()` is that section:
groups, sections placed, room use, the busiest period and what stands empty
during it, how far a student walks in a day and in a year, the longest move,
whether anything misses the bell, the tightest corridor. Null rather than an
empty panel when the design has no timetable — not a box of zeroes, which
would read as a school that never uses its rooms, and which is the same call
`reportCSV` already made by leaving its own block out.

The drawing half is where the work actually went, and it is a **refactor
rather than a copy**: the code panel and the day panel are the same object
drawn the same way — title, verdict badge, a line of context, key/value rows,
a per-storey block that says which sheet you are holding, a caveat in small
type — so there is one drawer and two shapes fed to it, and they stack down
the right-hand margin with a measured gap.

**The server.** The oldest line in the file, and the last one on either of the
first two lists: *no server ships*. `server/` is the other half of both
contracts in one process, no dependencies, four files — `store.js` (every
decision, no disk), `relay.js` (the rooms, and who a frame goes to), `ws.js`
(RFC 6455) and `index.mjs` (sockets, disk, and the order things happen in).
The three pure ones have suites; the fourth is exercised end to end.

Two things about it are worth carrying forward. The first is that **the
protocol was the phase** — the store's four endpoints were an afternoon, and
the WebSocket under the relay was everything else, because "one page of
anybody's favourite server" is true only once you have a WebSocket to relay
over. The second is that the two things most likely to make a deployment look
broken are neither of them in `wire.js`'s four-line contract: **CORS**, without
which the store works perfectly from curl and not at all from the tool, and
**TLS**, without which a page on `https:` cannot call it at all. The first is
in the code. The second is in the README, because it cannot be.

### What it cost, and what it taught

**The end-to-end suite earned its place in its first run.** `ws.js` had three
green suites of arithmetic about a protocol and a one-character error in the
handshake GUID, and every unit test agreed with it because every unit test was
asserting against the same wrong constant. `test/server.test.mjs` boots the
real server on a real port and drives it through `cloud.js`'s own four
functions and `wire.js`'s own `socketWire`, and it failed instantly with
*"Incorrect hash received in Sec-WebSocket-Accept header"* — from Node's own
WebSocket client, which is to say from a real implementation of the document
the module was written against. **That is now four phases in a row where the
thing that runs it caught what the arithmetic could not**, and the first one
where the arithmetic was not merely silent but actively wrong in chorus.

The corollary is sharper than the usual version of this lesson. Testing a
module you wrote against a spec you half-remember cannot find the places you
half-remembered it — the test and the code share the mistake. The only witness
that helps is one that did not read your memory: a real client, a real
browser, somebody else's implementation.

**The renderer half was checked in a browser, and it should have been all
along.** Every previous phase's renderer work has been "exercised by hand",
which is a phrase that means nobody checked it after the day it was written.
This one was driven with Playwright against the real page: a generated school,
into the walkthrough, press E at a landing, and assert that the camera
boarded, passed through the space between storeys and got out twelve feet
higher. That is thirty lines and it is the first time in this codebase that a
claim about the *renderer* has been checked by anything but a person looking
at it. The fourth arc's first sentence — *"nothing headless checks what any
sheet looks like, and that is the largest untested surface left"* — has an
obvious first move now, and it is not headless: it is a browser.

The blueprint suite took the cheap half of that immediately. A recording 2D
context cannot say whether a sheet is legible, but it can say that each panel
was drawn once, inside its own measured box, with the second under the first
rather than on top of it — which is precisely the assertion the panel refactor
needed and which "every existing test still passes" would not have made.

**A phase with three theses is three phases, and this one got away with it
because none of the three touched the others.** `lift.js` and `walkthrough.js`
and `render.js`; `report.js` and `blueprint.js`; `server/`. Not one shared
file between the three groups, and the only shared *idea* was the one in the
question that started it. That is the exception that proves the rule rather
than a counter-example to it: the reason Phase 10 and Phase 11 had to be split
was that their two theses were fighting over the same modules.

**On save versions: none, and none was possible.** A ride is a thing that
happens to a walker, a panel is a reading of a report, and a server holds the
file rather than changing it. Twenty-five phases, eleven save versions, and
nobody has lost a design.

**What is still not done, stated plainly:** nobody has deployed the server.
It runs, it is tested, and it is somebody's decision where to put it — which
is genuinely the last thing, and it is the only item in this document that
cannot be closed by writing code.

---

## Suggested build order

**Phase 12 is done**, and doing it first, alone, and reviewing it as its own
phase was the right call for the reason Phase 10 gave: the one regression it
shipped crossed three module boundaries, and a phase with a second thesis in it
would have buried the fire drill that found it.

**Phase 13 is done too**, and it was not on this list at all: it came out of
somebody using the thing. Which is the argument for keeping a phase's worth of
room for whatever a real session turns up, rather than working the list
straight down.

**Phase 14 is done as well**, and it was worth doing before 15 and 16 for a
reason that was not obvious from the list: it is the only one of the three
whose *prerequisite* was Phase 12, and doing it while the id work was recent
is what turned up the id-allocator hole in an afternoon rather than in a bug
report. It also cost nothing anywhere else — no geometry module changed —
which is what a transport phase should look like.

**Phase 15 is done**, and doing it before 16 was the right way round for a
reason the list did not predict: it is the one that turned up a distinction the
tool had been quietly conflating — a roll and an occupant load are not the same
number — and 16 is about to price a building room by room, which is a third
number that looks like the other two. Better to have had that argument before
there was money in it.

**16 is done**, and it was the safest of what was left, exactly as this
paragraph said — four new modules, four new suites, and not one line of
geometry touched. The prediction that mattered was the one about *ordering*:
doing 15 first was right because 15 turned up the roll-versus-occupant-load
distinction before there was money riding on it. What 16 turned up in the same
place was smaller and the same shape — a takeoff quantity and an estimate line
that share a name and answer different questions — and having had the argument
once made it a comment rather than a bug.

**17 is done, and it was the last of them.** It was independent of all of them
exactly as this paragraph said, and it cleared seven backlog items rather than
six — which is the thing worth carrying forward. The list had those seven filed
under four different headings (Analysis, Generation, Play, Files and
performance), and writing the phase brief is what put them next to each other
and showed they were one item. **A phase whose items sit under one heading is
usually a phase; a phase whose items are scattered across four and share a
workaround is usually a missing sentence.** That is the third time this
codebase has found that shape and the first time it was found by re-reading the
list rather than by a bug.

**Doing 17 last was right, and not for the reason the list gave.** The stated
reason was that it was independent, so it could go anywhere. The real one is
that it needed Phase 5's heightfield, Phase 8's scheme contract, Phase 10's
greedy mesher, Phase 12's room ids and Phase 16's report sections all to exist
already — it is the only phase in the arc that reused something from every
previous one, and it added less new code than any of them relative to what it
changed. **The cheapest phase is the one whose parts were all built for other
reasons.**

**On save versions:** Phase 15 spent none of its own — a timetable is an
append to v11, exactly as this section predicted, and a design that has never
been given one writes no key at all. Phase 12 spent the expensive one, and
spent it on a shape change rather than an append — which should be the last
time that is ever necessary. Phase 13 changed a design's dimensions without touching the format
at all, because `w` and `h` have been in the file since v1 and the loader has
always read them against the same range the editor now writes. Phase 14 spent
none either, and could not have: a session is a thing that happens *to* a
design rather than a thing in it, and the day the file has to record one is
the day something has gone wrong with the split. A timetable (15),
a rate table and a phasing plan (16) are all appends to v11, which is the Phase
5 lesson (terrain, site and roof all landed in v7 together) applied
deliberately rather than discovered halfway through. Phase 16 spent two of them
in one go and neither cost anything: a design nobody has priced writes no
`rates` key and a design nobody has phased writes no `phasing` key. **Phase 17
spent none and could not have**, which is the strongest form of that rule: a
site mesh, a discharge distance, a scheme and a heap are all *derived*, and the
one thing it did add to a design — the campus's covered walks — went in as
ordinary site regions that somebody could have drawn by hand. Twenty-four
phases, eleven save versions, and nobody has lost a design.

**On scope:** the honest read of arc two is that the phases that went best were
the ones with a single sentence behind them — Phase 10's "the model knows more
than it says", Phase 7's "a drawing has to survive questions", Phase 12's
"there is one kind of room". Each of the six in arc three had one, and Phase 17
had the shortest of the lot — *the outdoors is somewhere, with distances in it*
— while touching the most files. If a phase starts growing a second thesis,
that is the signal that it is two phases, which is exactly how Phase 10 and
Phase 11 came to be split, and that split was the right call both times.

**18 is not in this order and could not have been.** It is not a phase that
was planned and then built; it is the three items a reader found by asking
what was still open, and the whole of its scoping was reading Part one and
noticing which lines had a "still" on them rather than a reason. Which is an
argument for the shape of this document rather than for anything in the phase:
**a backlog that says why each thing was left is a backlog somebody can audit
in an afternoon.** Seven phases in this arc found their scope in a brief; this
one found it in the honesty of the list.

**On refactors, now that one has been done:** a phase whose deliverable is
subtraction needs a test that would fail if the subtraction were wrong, and
"every existing test still passes" is not that test. Phase 12's regression sat
underneath a thousand passing assertions. Whatever the next one is, find the
suite that runs the thing rather than calculating about it, and watch that one.
Phase 17 took that literally and it paid twice: the head test's two bugs were
both found by the fire drill — the suite that *runs* the building — while every
suite that calculates about it stayed green. That is now three phases in a row
where the simulation caught what the arithmetic could not.

---

## Where a fourth arc would start

Arc three is finished, Phase 18 closed the three things that were left over
rather than left deliberately, and this document has no next phase in it —
which is the right state for it to be in. What follows is not a plan; it is
the shortest honest list of what the standing backlog above still says,
grouped by the sentence each group is missing.

**"A drawing is a set of sheets, not a picture."** The blueprint draws on
canvas and is exercised by hand — the specification sheet and the site plan
both are. This is still the largest untested surface in the codebase, but it
is no longer untouched, and Phase 18 changed what the first move should be
twice over. The blueprint suite now has a recording 2D context that can assert
*arrangement* — what was drawn, how many times, inside which box — which is
cheap and catches a whole class of mistake. And the renderer was checked in a
real browser with Playwright for the first time, which is the move that
actually answers this sentence: a sheet's canvas in a real browser, compared
against a picture of it, is a day's work and would close this outright.

**"A design has a history somebody else can read."** Undo is a diff and a
session is a stream, but neither is a record: there is no way to ask what
changed between two versions of a design, and the collaboration phase made
that a question two people can now genuinely have.

**"The model knows what it does not know."** Several readers still answer with
a number where they should answer with a range — daylight is a glazing ratio
rather than a daylight factor, acoustics is Sabine and nothing else, and the
cost has no contingency in it because it has no idea how uncertain it is.
Every one of those is labelled honestly today; none of them is *quantified*.

**"Two people is not two windows."** Phase 18 shipped a relay, which means the
Phase 14 backlog under **The session** stopped being theoretical: storeys have
no ids so adding one is a whole-design resync, the tracing image and the model
library travel only in a snapshot, nothing is acknowledged and nothing is
retried, and undo is local and wins. Every one of those was written down as a
deliberate deferral by a phase that could not test them against a real
network. There is one now.

The rule for whoever picks this up is unchanged and is the first thing in this
document: read part one before touching anything, and add to part two rather
than starting a third list.
