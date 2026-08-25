# School Generator — Feature Wishlist

Two arcs are finished. The first — eight phases, from a single-floor grid
editor to a multi-storey, furnished, polygon-roomed building you can blueprint,
save and walk through on desktop or touch. The second — eleven more, from a
real furniture catalog through doors, light, sound, the site, a living crowd,
analysis, the generator that earned the tool its name, the sharing that took it
out of the tab it was drawn in, the nav mesh that made every number it prints
true, and a last one that made the building fun to be in rather than only
accurate to stand in.

**Everything on both of those lists shipped, bar one item: real-time
collaboration, which needs a server and is picked up below.** Nineteen phases,
57 modules, ~34,000 lines, 998 tests, ten save-format versions and no build
step.

This document is now two things, and the rule for a builder is the same as it
has always been: read the first part before touching anything, and add to the
second part rather than starting a third list.

- **Part one — where the tool stands.** What it is, the architecture that
  emerged, the conventions a new builder has to know before their first edit,
  what the nineteen phases shipped, what fought back, and the standing backlog
  no phase has claimed.
- **Part two — arc three.** Five phases, none of them started. Not a spec — a
  scoped list to pull from and refine before beginning each piece.

Each of the nineteen phases used to have its own retrospective here — what
shipped, how it landed, what fought back, what was left. Those are condensed
below into the parts that are still load-bearing; the long versions are in this
file's own history (`git log -p WISHLIST.md`) if a specific phase ever needs
re-reading.

---

# Part one — where the tool stands

## What it is

A single-page tool at `Projects/school-generator/index.html`. No build step, no
dependencies beyond a vendored three.js, no server. Open the file and it works;
push the file and it is deployed.

It draws a school in plan and walks through it in first person. The plan has
storeys, grid rooms and polygon rooms, walls that know whether they are
exterior, doors that swing, windows in bands, stairs and ramps and lifts that
cut their own openings, a graded site with hardscape on it, and a roof over the
lot. The walkthrough has collision, gravity, doors that open as you approach,
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

The model, bottom-up: `grid.js` (cells, edges, storeys) · `shapes.js` (polygon
rooms, rings, holes, per-segment walls) · `props.js` (the object layer and
inter-floor links) · `catalog.js` (every placeable type, as data) ·
`walls.js` / `openings.js` / `finish.js` (derived thickness, door leaves and
window bands, floor and paint) · `stairs.js` (runs, landings, the holes they
cut) · `terrain.js` / `site.js` / `roof.js` (the ground, what is drawn on it,
what covers the building) · `save-load.js` (v10, additive, migrating).

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
a pure module (`propplace.js` picks and snaps; `shapes.js` does the rings), and
`main.js` wires all of it to the DOM.

## Conventions a new builder must know

Read these before the first edit. Every one of them was learned by getting it
wrong.

- **Add a pure module and its test suite together.** No exceptions. It is why
  this codebase stays debuggable at 34,000 lines.
- **Save-format changes stay additive**, are validated in `deserialize()`, and
  never rename the autosave key. Unknown content survives; unknown boundaries
  default to *more* solid, not less. Ten bumps and nobody has lost a design.
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
- **Selection lives in tools, never in the file.** So does anything that is a
  decision about this editing session rather than about the building: whether
  overhangs are allowed, which decoration pack is open, where a shoved chair
  currently is.
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
  puts it. Test from the state the caller actually produces.

## The two arcs, in brief

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

The two phases that turned out to matter most to everything after them were
**Phase 1**, which shipped first and out of order and which every later phase
leaned on, and **Phase 7**, which put the analysis in front of the generator so
that "generate" had something to be judged by. The one that paid for itself
most obviously was **Phase 10**: measured over the mesh instead of over room
hubs, a generated three-storey high school lost a mean of 9ft of travel
distance per room and 60ft off its worst one — numbers nobody had ever walked.

## What fought back, across nineteen phases

- **Two room representations is a standing tax.** Every shared tool — wall,
  door, erase, measurement, blueprint, collision, mesh — handles both, forever.
  It was the right trade (the lattice really is faster for rectangles) and it
  is paid on every new feature. Phase 12 below is the proposal to stop paying
  it.
- **Grid rooms have no identity.** A cell is an index into a flat array, so
  there is nothing to name when something happens to a room. This blocked
  section editing until rooms could be promoted to polygons, and it is what
  real-time collaboration is *actually* blocked on — not a sync library.
- **JSON-clone undo is O(design).** Fine at school scale, and the thing that
  will bend first if prop counts grow tenfold.
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

## The standing backlog

Everything below was left deliberately, with a reason, by the phase that found
it. Items an arc-three phase picks up are marked with the phase that claims
them; the rest are unclaimed and can ride along with whatever is open.

**Model and geometry**
- Switchback ramps — one straight run means an ADA-compliant ramp is 144ft
  long and rarely placeable indoors.
- An elevator that moves. The car teleports with `E`; there is no ride, no call
  button, and the doors are drawn parked open. → *Phase 14 wants the queue.*
- Curvature isn't stored, so re-bending a wall after a reload starts from its
  chords. Curved walls are chords in the collider too.
- Wall paint is one colour per wall, not per face — splitting it is a renderer
  change, not a model one.
- Vertical collision: the walker is still a circle with no head, so you can
  walk under a stair run. Skipped in both arcs. → *Phase 16.*
- A pitched roof over a curve is a stepped rectangle; a straight skeleton would
  fix it and is a phase of its own.
- Site regions can be restyled and deleted but not re-shaped.
- The mesh is inscribed, not exact — a diagonal wall keeps its stair-step, and
  the walk along it comes out a foot long. Gates are midpoints rather than
  funnels.

**Analysis**
- The discharge route stops at the door: the outdoors is one node. → *Phase 16.*
- No prices, on purpose. → *Phase 15 proposes the honest version.*
- Daylight is a glazing ratio, not a daylight factor — nothing knows about
  orientation, overhangs or room depth.
- Common path of egress travel is a constant that nothing measures.
- Accessibility stops at routes: no turning circles, reach ranges or counter
  heights.
- The report doesn't print. A title-block code panel on the blueprint is its
  natural other half. → *Phase 15.*
- Sprinklered is a checkbox rather than a property of the design, because
  nothing about the analysis is saved. → *Phase 12.*

**The crowd**
- The timetable is random: nothing balances class sizes, matches subjects to
  rooms, or keeps a cohort together. → *Phase 14.*
- The crowd doesn't know the occupant load the report computed. → *Phase 14.*
- The last fifth of an evacuation is a tail — a few agents work their way out
  of a corner the crowd shuffled them into.
- Nobody carries anything, opens a locker, or talks.

**Generation**
- Three schemes, not four. A campus of separate blocks is the interesting one,
  because it is the first scheme where the building is not one connected
  thing. → *Phase 16.*
- Adjacency cannot move a room into a bigger slot — only same-sized rooms swap,
  so "the band room next to the library" is unachievable when no slot beside
  the library is band-room-shaped. The compact block often cannot honour an
  "away from" rule at all, and says so per rule rather than pass/fail.
- A generated school is furnished before it is checked: `furnishAll` stops at
  the prop cap and nothing asks whether it was hit in the middle of a
  classroom.
- The structural shadow is measured at 4ft, so a wing that oversails by three
  feet doesn't register; a polygon room is refused or allowed wholesale rather
  than clipped.
- The tracing overlay is an edit-mode underlay only — it isn't on the printed
  sheet, and nothing traces it for you.

**Play**
- Nothing is hidden outdoors: the mesh covers rooms, so the hunt stops at the
  walls. → *Phase 16.*
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

**Files and performance**
- glTF textures, PBR materials, skins, morph targets and Draco are each a
  refusal with a sentence attached in `gltf.js`.
- No `EXT_mesh_gpu_instancing` on export, so a furnished school is four
  megabytes rather than a few hundred kilobytes. → *Phase 16.*
- `findPath` sorts an array for its open set. Right at three hundred nodes,
  wrong at three thousand. → *Phase 16.*
- A tour moves the camera and does nothing else — no bell at a stop, no hour
  scrubbed between two, no audio on the recording.
- Cloud saves: the first item that needs a server, and now with a measured
  reason to want one, since a design with a tracing image or imported models
  cannot travel in a link at all. → *Phase 13.*

---

# Part two — Arc three: the building in use

Arc one made a building. Arc two made it real enough to measure and pleasant
enough to stand in. What neither of them did is let anybody *use* it — and the
five phases below share one sentence: **the tool knows everything about the
building except who it is for.**

It cannot name a room, so nothing outside the file can refer to one and nobody
else can edit one with you. It fills the school with a plausible crowd rather
than this school's crowd. It counts what the building is made of and refuses to
say what that costs. And it stops at its own front door — the site is scenery,
the discharge route ends at the threshold, and every scheme makes exactly one
connected thing.

Phase 12 is the prerequisite for three of the other four and is the riskiest
piece of work either arc has proposed. Phase 16 is independent of all of them
and is the one to reach for when the appetite is for a self-contained win.

## Phase 12 — Identity

**The model can describe a building. It cannot refer to one.**

A polygon room is an object with an id. A grid room is a flood-fill label — a
set of cells that happen to be connected this frame — and it has no id, no
record, and no way to be pointed at from outside. This has been the answer to
"why not?" four times now across two arcs: it is why section editing waited for
polygons, it is why the analysis is not stored, it is why undo is a whole-design
JSON clone, and (Phase 9 established this precisely) it is what real-time
collaboration is blocked on, on *this* side of the wire, rather than on a sync
library.

It is also the standing tax. Every shared tool handles both representations,
forever, and the cost is paid on each new feature rather than once.

The proposal is to stop paying it: **make the polygon the only representation
of a room**, and give a room a record of its own. `convertRegion()` has done
the promotion per-room since arc one, so the machinery exists and has been in
use for nineteen phases; what is new is doing it to everything, on load, and
deleting the other path.

This is the expensive one. It touches every module that reads `floor.cells`, it
opens save v11 with a real migration rather than an append, and it is the first
phase in either arc where "the tests all still pass" is the acceptance
criterion rather than a side effect.

- [ ] **Every room is a polygon, with an id.** Migrate on load: flood-fill each
  grid region once and promote it, exactly as `convertRegion()` already does,
  then never look at `cells[]` for room membership again. The lattice stays as
  the *drawing* surface — painting floor with a 4ft brush is a good gesture and
  nothing is proposing to lose it — but what it paints is a polygon's ring.
- [ ] **A room record.** `{ id, name, group, finish, paint, load }` — and with
  somewhere to put them, the four things Phase 7 said would open a bump finally
  land: occupancy group, code edition, a design occupant load somebody typed,
  and whether the building is sprinklered. The analysis stops being a reading
  the file forgets.
- [ ] **Delta undo.** With ids on everything, an undo step is a list of changed
  records rather than a clone of the design. This is the item v1's retrospective
  said would bend first, and it is nearly free once identity exists.
- [ ] **Save v11, with a migration and a test per version.** Every earlier save
  in `test/` opens, migrates, and round-trips to the same building. This is the
  first bump that changes a shape rather than adding to one, and it should be
  the last one that ever needs to.
- [ ] **Delete the second path.** The measure of success is subtraction:
  `wallSegments`, `floorRooms`, `meshFloor`, `blueprint`, `collide`, `egress`
  and the four editors each lose their lattice branch. If the diff is not
  mostly red, the phase did not happen.

*Leans on:* `convertRegion()`, `shapes.js`, and nineteen phases of tests as the
acceptance criteria;
*collides with:* everything — which is the point, and the argument for doing it
alone, first, and reviewing it as its own phase the way Phase 10 was.
*Save:* v11, and the expensive kind.

## Phase 13 — Two people, one plan

**The one item on either list that was never built.**

Every arc has named it and every arc has been right to defer it. Phase 9 was
the one that made the reason precise: it is not blocked on a CRDT library, it
is blocked on there being nothing to name. Phase 12 removes that, and what is
left is genuinely a networking phase — the first thing in this project that
needs a server, and the second is right beside it.

The honest scope is small. Two teachers round a laptop is the real use; a
design studio with twelve people in it is not what this tool is for.

- [ ] **The design as a log, not a snapshot.** An edit becomes an operation
  against a room id, a prop id or a link id — `move`, `rename`, `restyle`,
  `add`, `remove`. The file stays what it is; the log is what travels. Phase
  12's delta undo is the same list read backwards, which is the argument for
  doing them in this order.
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

*Leans on:* Phase 12's ids and its delta log, `save-load.js`'s serializer,
`share.js`;
*collides with:* nothing in the model — this phase adds a transport, and the
strongest sign it is going right is that no geometry module changes.
*Save:* none to the design. A session id and a log live beside the file.

## Phase 14 — A real school day

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
  sections to rooms by name — and, once Phase 12 exists, by id, which is the
  difference between a binding that survives a renamed room and one that does
  not. This is the item that makes the whole phase worth doing for somebody who
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
append to Phase 12's v11, not a bump of its own, if the two are done in order.

## Phase 15 — What it costs

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

## Phase 16 — Outward

**The building stops at its own front door.**

Four separate refusals, one cause. Exit discharge ends at the threshold because
`navgraph.js` flattens the whole outdoors into a single node. The scavenger
hunt cannot hide anything on the playing field because the mesh covers rooms
and nothing else. Every layout scheme makes exactly one connected thing. And
the graph gets slow at exactly the size where you would want more than one
building — because `findPath` sorts an array for its open set, which is the
right trade at three hundred nodes and the wrong one at three thousand.

Nothing here is waiting on Phase 12, which makes this the phase to reach for
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

**Phase 12 first, alone, and reviewed as its own phase.** Three of the other
four want room ids, it is the only one that changes a shape rather than adding
to one, and Phase 10 established that risky work grouped together and reviewed
together is how the bugs that cross module boundaries get found. If it goes
badly it should go badly on its own.

**Then whichever of 13, 14 and 15 the appetite is for.** They do not touch each
other. 14 is the one that makes the tool useful to somebody who already has a
school; 15 is the safest and the most obviously finishable; 13 is the one that
has been on the list longest and the only one that needs infrastructure this
project has never had.

**16 whenever.** It is independent of all of them, it clears six backlog items
between them, and it is the only one of the five that could be started tomorrow
against the code exactly as it stands today.

**On save versions:** Phase 12 spends the expensive one. If 14 and 15 follow
it, their timetable and rate table are appends to v11 rather than bumps of
their own — which is the Phase 5 lesson (terrain, site and roof all landed in
v7 together) applied deliberately rather than discovered halfway through.

**On scope:** the honest read of arc two is that the phases that went best were
the ones with a single sentence behind them — Phase 10's "the model knows more
than it says", Phase 7's "a drawing has to survive questions". Each of the five
above has one. If a phase starts growing a second thesis, that is the signal
that it is two phases, which is exactly how Phase 10 and Phase 11 came to be
split, and that split was the right call both times.
