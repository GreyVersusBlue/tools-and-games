# School Generator — Feature Wishlist

**Status: all eighteen planned phases are shipped.** Three arcs, a grid editor
to a walkable, furnished, generated, priced, networked school. Full history —
what each phase did, what fought back, why phases were ordered the way they
were — lives in `git log -p WISHLIST.md`; this file keeps only what a builder
needs going forward: the architecture, the conventions that were learned the
hard way, and the standing backlog.

## What it is

A single-page tool at `Projects/school-generator/index.html`. No build step,
no dependencies beyond a vendored three.js, no server required (though one
exists — see `server/`). Open the file and it works; push the file and it is
deployed.

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
per-segment walls) · `lattice.js` (the 4ft drawing surface, and `bake()`, the
one door out of it) · `paint.js` (the brush) · `props.js` (object layer,
inter-floor links) · `catalog.js` (every placeable type, as data) ·
`walls.js` / `openings.js` / `finish.js` (derived thickness, door leaves,
window bands, floor/paint) · `stairs.js` (runs, landings, the holes they cut)
· `terrain.js` / `site.js` / `roof.js` (ground, site drawing, roof) ·
`rates.js` (cost vocabulary) · `history.js` (an edit as a diff) ·
`save-load.js` (v11, one migration that ever changed a shape).

What it derives: `navgraph.js` + `navmesh.js` (walkable surface as convex
tiles, graph over it) · `sitemesh.js` (the same, over the outdoors) ·
`collide.js` (what stops/holds you up) · `occupancy.js` / `egress.js` /
`daylight.js` / `takeoff.js` / `acoustics.js` / `utilisation.js` / `cost.js` /
`spec.js` / `phasing.js` / `report.js` (analysis, none of it stored) ·
`lights.js` / `sky.js` / `sound.js` (emitters, sun, audio sources) ·
`shadow.js` (what an upper storey stands on) · `blueprint.js` (printable
sheet) · `minimap.js`.

What it generates: `program.js` (room counts) · `brief.js` (a sentence read
into that program) · `timetable.js` (class/room/period packing) ·
`generate.js` (room placement, four schemes) · `autofurnish.js` +
`templates.js` · `sample.js`.

What it plays: `schedule.js` (the day as five numbers) · `agents.js` (a
seeded population with timetables) · `shove.js` (bump a chair) · `hunt.js`
(scavenger hunt) · `decor.js` (seasonal palette) · `lift.js` (a car with a
call button and a queue).

What it shows and shares: `render.js` (the three.js scene) · `audio.js` (Web
Audio graph) · `walkthrough.js` / `xr.js` / `touch.js` (three input paths,
one physics) · `gltf.js` + `models.js` (glTF read/written by hand) ·
`share.js` (a design deflated into a URL fragment) · `tour.js` · `overlay.js`.

What it shares with another person: `session.js` (a design as records, and
which of two edits wins) · `presence.js` (who else is here) · `wire.js` (the
pipe — loopback, `BroadcastChannel`, or a WebSocket relay) · `cloud.js` (a
design store, client + contract) · `server/` (the store and relay
themselves, no dependencies). **No module above this paragraph imports any
module in it.**

The editor is `editor.js` plus one tool per verb — `polyedit`, `propedit`,
`stairedit`, `templateedit`, `siteedit`, `overlayedit` — each thin over a
pure module, and `main.js` wires all of it to the DOM.

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
- **Anything outside the file that names a room names its id, and keeps the
  name it bound by.** Bind by id, then by name, then by room number — never
  drop what you could not bind: report it. See `bindRoom` in `timetable.js`.
- **Selection lives in tools, never in the file.** So does anything that is a
  decision about the editing session rather than the building. Anything that
  is a fact about the *building* (occupancy group, design occupant load, code
  edition, sprinkler answer) belongs in the file.
- **The walkthrough collider is built once at walk-start.** Editing and
  walking are exclusive. The crowd owns the colliders when it is running.
- **Ctrl-combos route through `main.js`,** not through the tools' generic key
  handling.
- **Undo restores a snapshot with `Object.assign`, which only ever adds.**
  Any *optional* record on the state (`terrain`, `site`, `roof`, `life`,
  `timetable`, `overlay`, `models`, `tours`) has to be deleted when the
  snapshot doesn't have it, or undoing past the moment it was first written
  silently does nothing.
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
- **A partition belongs to exactly one of the two rooms it divides.** One
  builds a wall on it, the other leaves the segment open, decided by reading
  order at bake time. Anything that has to be true of *both* sides (borrowed
  light) has to say so explicitly.
- **`hand` and `sw` are relative to the run, and a run has a direction.** A
  ring is wound, so half its segments run the other way; a door copied onto
  one without flipping both fields hangs on the far jamb. `bake()` and
  `paint.js` both correct for it; anything else that moves an opening
  between segments must too.
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
- **A cost that is not a distance is how this codebase says "yes, but".**
  `OUTDOOR_COST`, `STAIR_COST`, `ELEVATOR_COST` and `FLOOR_PENALTY` all
  charge `cost` and never `dist`, so a route can be discouraged from a path
  without lying about how long it is.
- **A property of the answer is not always a property of the search that
  found it.** Measure things like steepest grade on the route once,
  afterwards, rather than threading a running value through the pathfinder.

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
- Common path of egress travel is a constant that nothing measures.
- Accessibility stops at routes: no turning circles, reach ranges or counter
  heights.
- The code edition is printed, not applied — three editions are offered and
  none changes a factor or limit.
- Findings themselves are still only in the report panel and the CSV; the
  title-block panels carry a verdict and a count, not the finding text.

**The crowd**
- An imported timetable has no teachers (the `Tools/` CSV has no teacher
  column), so "no teacher free" never fires on one.
- Lunch is still `pickLunchroom` (largest common room) rather than a sitting
  the timetable schedules.
- The corridor crush rule (facilities rule of thumb) and egress width (code
  limit) are never reconciled.
- The last fifth of an evacuation is a tail — a few agents work out of a
  corner the crowd shuffled them into.
- Nobody carries anything, opens a locker, or talks.

**Generation**
- Adjacency cannot move a room into a bigger slot — only same-sized rooms
  swap, so an "away from" rule often can't be honoured at all.
- A generated school is furnished before it's checked — `furnishAll` stops
  at the prop cap and nothing asks whether it was hit mid-classroom.
- The structural shadow is measured at 4ft, so a wing oversailing by three
  feet doesn't register; a room is refused or allowed wholesale rather than
  clipped.
- The tracing overlay is edit-mode only — it isn't on the printed sheet.
- The campus scheme is always the same shape (front building, quad, row of
  pavilions) where a real one wraps a hillside.

**Play**
- A hunt cannot survive a structural edit — hints name rooms that may no
  longer exist.
- Warmth is a straight line plus a per-storey charge, not routed, so
  something thirty feet away through a wall reads as hot.
- A colour variant cannot recolour an imported model; a prop has one paint.
- The crowd cannot shove anything, and a shove treats a prop as a circle of
  its own half-width.

**Light, sound and picture**
- Generic ceiling troffers don't emit (twelve-light budget), and there are
  no shadows from the building's own lights; light doesn't respect geometry,
  only distance.
- No clouds — a canvas smear reads worse than a clean gradient, and real
  clouds are a shader project.
- Transmission loss is one number per situation rather than a ray cast, and
  there are no early reflections.
- Photo mode and the minimap are both desktop-shaped, not laid out for a
  phone.

**The room model**
- A boundary that bounds no room cannot be drawn (a free-standing garden
  wall, a wing wall that stops halfway). The fix is a boundary that belongs
  to the *storey* rather than a room — a schema addition.
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
- Shrinking the sheet can strand a lattice-aligned room outside it; the
  missing verb is "move everything on this storey by (dx, dz)".
- A design's dimensions aren't part of what a scheme generates against — the
  generator always sizes a fresh state from its own plan.
- The wall drag's parallel-segment fix deliberately isn't applied to the
  erase tool, which has the same corner problem.
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

## Where a fourth arc would start

Not a plan — the shortest honest list of what the backlog above still says,
grouped by the sentence each group is missing.

**"A drawing is a set of sheets, not a picture."** Mostly closed:
`test/visual/` compares the floor plan and site plan against committed
baselines in a real browser. What's left is a pure entry point to the report
pipeline, so the specification sheet (which needs the report's numbers) can
join the harness too.

**"A design has a history somebody else can read."** Undo is a diff and a
session is a stream, but neither is a record — there's no way to ask what
changed between two versions of a design, which two people editing one plan
concurrently now genuinely need.

**"The model knows what it does not know."** Several readers still answer
with a number where they should answer with a range — daylight is a glazing
ratio rather than a daylight factor, acoustics is Sabine and nothing else,
and cost has no contingency because it has no idea how uncertain it is. Every
one of those is labelled honestly today; none of them is *quantified*.

**"Two people is not two windows."** With a relay now shipped, the session
backlog above (storey ids, snapshot-only assets, no retry, local-wins undo)
stopped being theoretical — there's a real network to test it against.
