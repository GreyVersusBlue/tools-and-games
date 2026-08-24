# School Generator — Feature Wishlist

Living reference for where this tool goes next. The v1 model (merged in #38)
was a single-floor, grid-based editor + first-person walkthrough: rectilinear
rooms only, no furniture, no multi-story. **Phases 1 through 4 have since
landed** — the state is multi-floor, rooms can be arbitrary polygons, there's a
furnished prop layer with a catalog and instanced rendering, and the storeys are
now joined: stairs that cut their own opening in the floor above, railed
mezzanine voids, and glass walls on both room representations (see those
sections for what was decided and what it means for the phases below). This
document breaks down the remaining improvements — walkthrough collision, editor
polish, export — into a rough build order, and calls out where each one collides
with assumptions baked into the current code.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas
under the right phase rather than starting a second list.

## Current architecture, in brief

(`js/grid.js`, `js/shapes.js`, `js/props.js`, `js/catalog.js`,
`js/propplace.js`, `js/stairs.js`, `js/sample.js`, `js/editor.js`,
`js/polyedit.js`, `js/propedit.js`, `js/stairedit.js`, `js/render.js`,
`js/walkthrough.js`, `js/save-load.js`, `test/model.test.mjs`,
`test/shapes.test.mjs`, `test/catalog.test.mjs`, `test/propplace.test.mjs`,
`test/stairs.test.mjs`)

- **Two room representations, side by side.** The cell grid is the fast
  rectangular mode: a floor is a flat `cells[]` array (4ft cells) plus
  `edgesH[]`/`edgesV[]` for walls/doors living *between* cells. Alongside it,
  `floor.shapes[]` holds polygon rooms — outlines in world feet, at any angle,
  with holes. `state.floors[]` stacks both on a shared footprint at 12ft
  intervals.
- **A grid room is a label; a polygon room is an object.** On the grid, "room"
  is a flood-fill (`floodRegion`) over contiguous floored cells bounded by
  walls/doors, tagged with a name + color. A polygon room is an explicit
  `{ id, name, color, rings }` record that owns its own boundary, per-segment
  walls and doorways. `convertRegion()` promotes the first into the second.
- **The prop layer is furnished.** `props.js` holds free-floating objects in
  world feet with ids, floors, rotation, scale and mount kind; `js/catalog.js`
  gives `type` meaning (footprint, mount, procedural geometry key) and
  `js/propedit.js` is the placement/selection tool, palette-driven the same
  way the room-color swatches drive the room tool. `assets/models/` is
  still an empty placeholder (`.gitkeep` only) — Phase 3 stayed procedural.
- **`state.links[]` joins the storeys.** A link is a stair or a plain floor
  opening: it stands on `from`, arrives at `to = from + 1`, and cuts a hole in
  that upper floor's slab *and* the lower one's ceiling. `js/stairs.js` owns
  every measurement — run, riser, the point up the flight where headroom fails
  and the cut has to start, the guardrails around the hole — and
  `js/stairedit.js` is the tool, built the way `propedit.js` is.
- **A boundary has a kind.** Grid edges run `0 none, 1 wall, 2 door, 3 glass,
  4 railing`; polygon segments run `SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL`.
  Anything non-zero bounds a room for flood fill — glass separates two rooms as
  surely as drywall does — and only the renderer and the walkthrough care which
  kind it is.
- **Rendering merges structure into a few big meshes, props into one
  `InstancedMesh` per type per floor.** Floor/wall/ceiling/fixture geometry is
  `mergeGeometries`'d per material, per storey, rebuilt from scratch on every
  edit — polygon rooms merge into the same meshes as the grid. Props are
  different: each catalog type's geometry is built once and cached, and every
  placed instance of it on a floor is one `InstancedMesh`, so a classroom's
  worth of desks costs one draw call rather than one `Mesh` each.
- **Walkthrough is no-clip, but it climbs stairs.** `PointerLockControls` with
  WASD + fly up/down and still no collision against walls or props — what it
  does have is `stairUnder()`: walk onto a run and the camera rides its surface
  up to the next storey. It spawns on the storey you were editing (in the
  biggest polygon room, if that storey has no grid cells), and the fly-up range
  covers the whole building.
- **Save format is versioned** (`version: 4`): floors (cells, edges, shapes) +
  props + links. `deserialize()` validates/clamps everything on load and
  migrates v1, v2 and v3 files forward — every bump so far has been additive,
  so an older file is simply a design with none of the newer things in it.

## Phase 1 — Foundational data model changes ✅ *done*

These were prerequisites for almost everything below, so they came first even
though none of them are visible features on their own.

- [x] **Multi-floor state.** `state.floors[]` replaces the single grid; each
  entry is exactly the old `{w, h, cells, edgesH, edgesV}` record, so every
  pure helper in `grid.js` now takes a *floor* and its body is unchanged.
  `currentFloor` picks the storey being edited and `state.links[]` is the
  inter-floor table stairs will use.
- [x] **A generic object/prop layer** (`js/props.js`), separate from the cell
  grid: `props: [{ id, type, floor, x, z, y, rotationY, scale, mount, data }]`.
  Free-floating (x, z) in feet, not grid-snapped.
- [x] **Save format version bump + migration.** `deserialize()` accepts v2 and
  migrates v1 files (and v1 autosaves already in someone's browser) into a
  one-floor v2 design. The autosave key is deliberately unchanged so an
  in-progress design survives the upgrade.
- [x] **Undo/redo strategy:** unchanged — `snapshot()`/`restore()` still
  JSON-clones the whole state, which now includes floors and props. Fine at
  present scale; revisit when prop counts make it feel slow rather than
  pre-optimizing now.

**Decisions made, since the rest of the list depends on them:**

- **Floors share one footprint and one grid origin.** `state.w`/`state.h`
  belong to the building, not the storey. Aligning stairs, mezzanine openings
  and floor cuts is the whole point of multi-floor, and a shared origin makes
  "the same cell on the level above" a plain index lookup. The cost is that
  you can't have a differently-sized upper storey — you leave its cells empty
  instead, which is what a real partial upper floor looks like anyway.
- **Floor-to-floor height is 12ft** (`FLOOR_H`): the existing 10ft `WALL_H`
  ceiling plus a 2ft plenum. Walls on any storey with something above it are
  drawn the full 12ft so the exterior has no gap band between levels; the
  ceiling mesh still sits at 10ft, so interiors are unchanged.
- **Max 8 storeys** (`MAX_FLOORS`), which also bounds what a save file can
  ask the renderer to build.
- **Prop `type` is an open string.** `props.js` deliberately ships no catalog
  — Phase 3 owns that, and keeping the layer catalog-free means an unknown
  type from a newer save survives a round-trip instead of being dropped.
  Type-specific fields ride in `data` (scalars, one level deep) so the core
  prop shape stays fixed as the catalog grows.
- **`mount: 'floor' | 'wall' | 'ceiling'`** is in the shape from the start, so
  Phase 3's wall-mounted TVs and smart boards don't need a second data model.
- **Ids are per-design and monotonic** (`state.nextId`). After a load,
  `reseedIds()` moves the counter past anything in the file so new placements
  can't collide with saved ids.

**What that changed elsewhere, beyond the data model:**

- A **floor panel** (bottom-left, `[` / `]` to move between storeys) — add,
  duplicate, delete, and switch. Not the Phase 6 layers panel, just enough UI
  to exercise the model: editing is one storey at a time, with the level below
  ghosted through for alignment.
- **Walkthrough** spawns on the storey you were editing and can fly the full
  height of the building. Still no-clip; labels show only for the floor the
  camera is on.
- **`test/model.test.mjs`** — `node --test` from this directory, no deps, no
  build step. Covers floor stacking, insert/remove renumbering of props and
  links, prop and link validation, v1→v2 migration, and hostile-input clamping.

## Phase 2 — Polygon room editor ✅ *done*

The most structurally invasive item on the list, since a "room" wasn't a shape
at all before this.

- [x] **Freeform polygon drawing tool** (`⬠ Polygon`, key 6): click to place
  vertices, close the loop by clicking the first corner or pressing Enter,
  Backspace takes back the last corner, Esc cancels. Snaps to existing
  vertices, to the 4ft lattice and to existing walls, so polygon rooms butt
  cleanly against grid-built ones; Alt places freely and Shift holds the run
  to 15° steps.
- [x] **Non-rectangular rooms.** A room is a list of rings, each ring a list of
  points in world feet with a `walls[]` entry per segment. Walls are no longer
  indices into a fixed edge array — that was the real schema change, and it's
  why `shapes.js` is a new module rather than an extension of `grid.js`.
- [x] **Room-in-room / carved alcoves.** Rings after the first are holes.
  Toggle "Cut hole" (H) in the polygon panel and draw inside an existing room
  to carve one out of it; the smallest room containing the loop is the one
  that gets cut.
- [x] **Vertex editing after the fact** (`✥ Shape`, key 7): click a room to
  select it, drag its corner handles, click a midpoint handle to insert a
  corner, Alt-click a corner to remove it, Delete removes the room. Handles
  and snap radius scale with the zoom level so they stay grabbable.
- [x] **Migration path** — decided and built, see below.
- [x] **Polygon-aware labeling.** A polygon room *is* its own region, so there
  is nothing to flood-fill: the name and color are fields on the shape.
  `computeLabels()` is untouched and still does the grid; `interiorPoint()`
  anchors a polygon room's label at the point deepest inside it, because the
  centroid of an L-shaped room can land in a wall or outside the room.

**Decisions made, since the rest of the list depends on them:**

- **Both representations stay.** The grid is documented as the fast rectangular
  mode rather than deprecated: most of a school is rectangles on a 4ft lattice,
  and drawing those as polygons would be slower for the person doing it and no
  better in the file. Polygons are for what the lattice can't say.
- **Migration is per-room and on demand, not a flag day.** Clicking a *grid*
  room with the Shape tool converts that region in place: the outline is traced
  (`regionToPolygon`), its name, color, walls and doors come along, and the
  cells are handed back. Walls shared with a neighbouring grid room stay on the
  grid — that partition belongs to the room on the other side too — and the new
  polygon leaves that segment open, so the two systems never draw the same wall
  twice. This is what makes "auto-convert everything" unnecessary: rooms move
  over when they outgrow the grid.
- **A doorway is a position along a wall, not a kind of wall.** On the grid a
  door is an edge value, because an edge is one cell wide. A polygon wall can
  be 30ft long, so its doorways are `{ seg, t, w }` openings — several to a
  wall, wherever you click. Erasing a wall takes its doorways with it.
- **Winding is normalized** (outer ring CCW, holes CW) and every mutation keeps
  `walls[]` and `openings[]` aligned with the points. That bookkeeping lives in
  `shapes.js` so no tool can get it wrong.
- **Per-segment wall state is an enum** (`0` none, `1` wall) rather than a
  boolean, so Phase 4's glass wall slots in as `2` without moving anything.
- **Polygon rooms are not bounded by the footprint.** `state.w`/`state.h` bound
  the lattice, not the building — a polygon wing can hang off the edge of it,
  which is what the sample school's Learning Commons does.

**What that changed elsewhere, beyond the data model:**

- **The shared tools understand both kinds of room.** Wall, Door, Room and
  Erase act on whichever is nearer the cursor — a polygon wall if one is within
  reach, the lattice edge otherwise. The Room tool names a polygon room the
  same way it names a grid region, from the same panel.
- **`buildSampleSchool()` moved to `js/sample.js`**, because the first-run demo
  now draws from both representations and `grid.js` stays a leaf module that
  imports nothing of the project.
- **Save format v3.** `floor.shapes[]` is additive, so a v1 or v2 file is
  simply a design with no polygon rooms in it; the autosave key is unchanged
  again, so an in-progress design survives the upgrade.
- **`test/shapes.test.mjs`** — 25 more `node --test` cases: winding and area,
  the label anchor, picking, the vertex/wall/doorway bookkeeping, snapping, the
  grid→polygon trace (including a region with a courtyard in it), floor
  duplication, save round-trips and hostile-input clamping.

## Phase 3 — Prop / furniture placement ✅ *done*

Phase 1's prop layer was in place and empty — nothing rendered props, and
there was no way to create one from the UI. This phase gave it a catalog, a
placement tool, snapping, and instanced rendering.

- [x] **Prop catalog** (`js/catalog.js`) — a data-driven list of 14 placeable
  types across five categories (Desks, Seating, Storage, Fixtures, Extras),
  each a plain row of `{ type, category, w, d, h, y, color, mount, geo }`.
  Desks, chairs, a file cabinet, two bookshelf heights, a cubby unit, a floor
  lamp, a wall-mounted TV/smart board and whiteboard, a rug, a trash can and
  a sink. Adding a new one is adding a row — `props.js`'s open-string `type`
  and `propedit.js`'s palette both read the catalog rather than a hardcoded
  list, per the decision Phase 1 made for exactly this.
- [x] **Placement tool** (`js/propedit.js`, `⑧` Furniture) — a palette panel
  (parallel to the room-color swatches) picks the current type; click empty
  ground to place it, click an existing prop to select it (Shift adds to the
  selection), drag a selected prop (or the whole selection, offsets
  preserved) to move it, `R`/`Shift+R` rotates 15° at a time, `Delete`
  removes. Dragging from empty ground instead draws a marquee box that
  selects whatever it covers — a deliberate split (see below) so a drag never
  half-places something.
- [x] **Snapping** (`js/propplace.js`, pure/no-three.js so it's unit-tested
  independently of the renderer) — three tiers, tried in order: a
  wall-mounted type snaps flush against the nearest wall (grid edge or
  polygon segment, whichever is closer) and turns to face whichever side of
  it the cursor was on; a floor-standing type snaps alongside a neighbouring
  prop of the same mount kind when the cursor lands near one of its four
  edges, matching that neighbour's rotation (the "line up a row of desks"
  case); failing both, it snaps to a 2ft furniture lattice (finer than the
  4ft wall grid — half as coarse reads right for 2ft-wide furniture).
  Alt ignores every tier for free placement, same modifier the polygon tools
  use.
- [x] **Geometry source**: procedural, as recommended — each catalog entry's
  `geo` key (`desk`, `chair`, `cabinet`, `shelf`, `cubby`, `lamp`, `panel`,
  `rug`, `bin`, `sink`) maps to a small box/cylinder kit in `render.js`,
  merged into one vertex-colored `BufferGeometry` per *type* and cached —
  same procedural-texture-over-asset-pipeline tradeoff the project already
  made, and `assets/models/` is still there as the upgrade path.
- [x] **Rendering at scale**: one `THREE.InstancedMesh` per (floor, prop
  type), rebuilt alongside the structural meshes on every edit but pointed at
  the *cached* geometry rather than rebuilding it — so 30 student desks cost
  one draw call, not thirty `Mesh` objects. `disposeGroup()` knows not to
  free geometry tagged `sharedGeo`.
- [x] Multi-select + copy/paste — marquee-select (see placement tool above),
  `Ctrl+C`/`Ctrl+V` copy and paste the selection at a small offset (repeated
  pastes step further out), `Ctrl+D` duplicates in one keystroke. These are
  Ctrl combos, which `editor.js`'s generic key routing deliberately never
  forwards to the polygon/prop tools (Escape/Delete/Enter etc. only), so
  `main.js` calls `editor.propCopy()/propPaste()/propDuplicate()` directly.

**Decisions made, since later phases depend on them:**

- **Selection lives in the tool, not in saved state.** `propedit.js` holds
  its own `Set` of selected ids, resolved back to live props by id on every
  use (and dropped if the prop's floor no longer matches the one being
  edited) — the same "re-resolve by id" pattern `polyedit.js` uses for its
  selected shape. Nothing about a selection is undoable or saved; only
  actual prop mutations push undo.
- **A click places, a drag marquee-selects — never both from one gesture.**
  Committing to which one a pointer-down *is* has to wait for pointer-up (or
  a movement threshold), because placing on every pixel of a drag would spam
  props the way the grid tools' `applyStroke` deliberately doesn't for a
  one-shot tool. The threshold and the snap tolerance both scale off
  `editView.height`, the same zoom-independent-feel trick `polyedit.js`
  already used for handle sizes.
- **Wall snap only applies to wall-mounted types.** A floor-standing desk
  drifting to face a wall it merely passed near would be surprising; a TV
  ignoring the wall it's obviously meant for would be useless. The catalog's
  `mount` field is what `propplace.js`'s `snapProp` branches on.
- **Rotation convention is `Object3D.rotation.y`, chosen once and used
  everywhere.** `propplace.js`'s `faceDirection(dx, dz)` computes the angle
  that makes a prop's local +Z axis point at a world direction — the
  convention every geometry builder in `render.js` was authored against (a
  panel's face, a chair's seat) and the one `propplace.js`'s tests check
  directly rather than trusting visually.
- **One shared material for every prop.** `propMat` is a single
  `MeshStandardMaterial` with `vertexColors: true`; each cached geometry
  bakes its own per-part colors in (the same trick `buildFloor` uses for
  cell tints and door jambs), so a desk and a bookshelf differ without a
  second material or texture. `coloredGeo()` (the helper both paths share)
  now also normalizes a plain `'#rrggbb'` string to a `THREE.Color` before
  reading `.r/.g/.b` off it — passing a bare string used to silently bake
  `NaN` into the color buffer, invisible until it reached a bloom pass.

**What that changed elsewhere, beyond the data model:**

- **`buildSampleSchool()` furnishes Room 101** — two rows of student
  desks/chairs, a teacher's desk and chair, a bookshelf, a rug and a wall
  whiteboard — both a demo and the thing that first exercised this phase's
  render path end to end.
- **`test/catalog.test.mjs`** and **`test/propplace.test.mjs`** — the
  catalog's shape and uniqueness, and picking/footprint/snap-tier coverage
  for all three snap kinds plus the free-placement escape hatch, run the
  same `node --test` way as the rest of the suite.

## Phase 4 — Architectural features ✅ *done*

The other structurally invasive phase: everything here needed the polygon model
underneath it, because a floor cut is a hole in a room and a railing is a
boundary segment whose kind isn't "wall".

- [x] **Stairs** (`js/stairs.js`, `js/stairedit.js`, `🪜 Stairs`, key 9) — a
  placeable structural object living in `state.links[]`, not in `props[]`,
  because it connects two storeys rather than sitting on one. Click to place a
  run out of the storey you're editing, `R`/`Shift+R` to turn it, drag to move
  it, `Delete` to remove. It:
  - Connects two floors at a specific (x, z) and heading — `from` and
    `to = from + 1`, since a run that skips a level isn't a stair, it's two.
  - Cuts its own floor opening in the level above, and the matching hole in
    the ceiling below it, so the run arrives somewhere instead of into a slab.
  - Rails that opening automatically on every side but the one you step off
    onto.
  - Is walkable: `stairUnder()` puts the walkthrough camera on the tread under
    its feet, so you climb to the next storey rather than flying through it.
- [x] **Mezzanine** — a partial upper floor overlooking the level below:
  - A `type: 'opening'` link is the same record without the treads: a hole in
    the floor above looking down into the floor below, sized however you want.
    That plus an upper storey that doesn't reach wall-to-wall *is* a mezzanine
    — the sample school's main hall is now two storeys tall with a railed
    corridor around it.
  - Railings are their own renderable thing: waist-high posts, a cap rail and
    a mid rail, drawn for a floor opening automatically and available by hand
    (`EDGE_RAIL` / `SEG_RAIL`) anywhere else.
- [x] **Glass walls** — `EDGE_GLASS` on the lattice, `SEG_GLASS` on a polygon
  segment (the `2` Phase 2 reserved for exactly this). Drawn as a framed
  curtain wall: sill, head, mullions every 5ft, and a transparent pane per
  bay in its own material. Glass bounds a room for flood fill the same way a
  solid wall does — the wishlist's own guess, and it's right: it separates two
  rooms without enclosing either.

**Decisions made, since the rest of the list depends on them:**

- **The wall tool builds one of three things, rather than there being three
  tools.** `WALL_KINDS` in `editor.js` maps a choice — solid, glass, railing —
  onto both an edge value and a segment value, and the Wall panel (or `G`)
  picks it. A fourth kind is a row in that table; it isn't a fourth button in
  a toolbar that's already nine deep.
- **Every boundary kind bounds a region.** `floodRegion` stops at anything
  non-zero, unchanged from v1. Glass separating two rooms is the case the
  wishlist called out, and a railing is the *edge of the floor*, which bounds a
  room more definitively than a wall does.
- **A stair's dimensions are derived, never chosen.** 7in risers and 11in
  treads against the storey height give 21 risers and 19.25ft of run at the
  default 12ft; change `floorHt` and every stair in the design re-proportions
  itself. The one number the tool exposes is width. Where the floor above has
  to open is derived too: the cut starts exactly where a climber's headroom
  would hit the slab.
- **The opening belongs to the floor above; the run belongs to the floor
  below.** `floorCuts(state, i)` asks "what is missing from this storey's
  slab", and the same list cuts the ceiling under it. Splitting it that way
  means each piece hides, ghosts and lights with the storey it belongs to, and
  neither floor's builder has to know about the other's geometry.
- **Cuts are computed, not baked.** Nothing mutates `cells[]` or a room's
  rings when a stair is placed — the renderer skips a cell (or hands
  `ShapeGeometry` an extra hole) wherever a cut covers it. Moving a stair
  therefore un-cuts the floor behind it for free, undo needs no special case,
  and deleting the link restores the slab.
- **A cell is cut if *any* of it is over the hole**, not if its centre is:
  half a cell hanging over a void reads as a mistake from the floor below.
- **A guardrail is only drawn where someone could walk up to it.**
  `openingRails()` probes just outside each side of the hole for floor on that
  storey and drops the sides that find none — otherwise an opening at the edge
  of a partial upper floor fences off thin air.
- **An unknown boundary kind from a newer save loads as a solid wall**, not as
  a gap. Losing a wall opens a room up; drawing an exotic one plainly does not.

**What that changed elsewhere, beyond the data model:**

- **The sample school is two storeys.** A staircase in the ground-floor stair
  hall climbs to Level 2 through the opening it cuts; 32ft of the main hall is
  left open as a railed atrium through both levels; the office fronts the hall
  in glass, the media centre upstairs does the same, and the Learning Commons
  polygon has a glazed curtain wall.
- **The toolbar hangs from the top** instead of being vertically centred — a
  centred column of nine tools reached the floor panel — and the side panels
  line up with it.
- **Save format v4.** New edge and segment kinds plus a populated `links[]`;
  both additive, so a v1/v2/v3 file loads as a design with no glass and no
  stairs in it, and the autosave key is unchanged again.
- **`test/stairs.test.mjs`** — 29 more `node --test` cases: the run geometry
  and its fallbacks, the headroom rule that positions the cut, the local frame
  and its round-trip, cut/footprint polygons under rotation, cell cutting,
  which sides get railed, walking up a run (including two stacked in one
  stairwell), placement refusals, floor-deletion cleanup, save round-trips and
  hostile-input clamping. Plus wall-kind coverage in `shapes.test.mjs` and
  `model.test.mjs`.

## Phase 5 — Walkthrough mode improvements

- [ ] **Collision detection.** Walkthrough is still no-clip against walls
  (`walkthrough.js` moves the camera freely through them). Everything to
  collide *with* now exists — polygon walls give it real line segments,
  props give it footprints, and glass and railings are segments it should
  stop at exactly like solid walls. This is the last big one.
- [x] **Floor-to-floor navigation** via stairs — landed with Phase 4, since a
  staircase you can't walk up is a decoration. `stairUnder()` in `stairs.js`
  answers "what is under my feet, and how high is it there"; the camera takes
  the tread's height whenever it's within a band of it, so you climb a run by
  walking at it. Deliberately a ramp rather than 21 discrete steps: a
  first-person camera stepping up in 7in jumps reads as a stutter.
- [ ] **Falling off mezzanines / floor edges** — now a real question rather
  than a hypothetical one, since a floor opening is a hole you can walk into.
  Decide between basic gravity and simply blocking movement at the edge
  (simpler, and may be enough for the tool's purpose). Note that the floor
  under the camera is already computable: `floorCuts()` says where a storey
  is missing, and `floorSolidAt()` says whether there's anything to stand on.
- [ ] Real PBR texture sets, per the upgrade path already documented in
  `assets/textures/README.md` (currently all procedural canvas textures).

## Phase 6 — Editor UX polish

- [ ] Layers panel: toggle visibility of floors independently, and props
  vs. structure, while editing (useful once multi-floor exists — you don't
  want to always see the floor above/below).
- [ ] Measurement / dimension display (room square footage, wall length)
  — `floodRegion`/`computeLabels` already compute region cell counts, which
  is most of the math needed for a footage readout.
- [ ] Room/prop templates or presets ("standard classroom", "computer lab
  row") to speed up repetitive layout work.
- [ ] Extend multi-select, copy/paste, and mirror/rotate to whole room
  sections, not just individual props.

## Phase 7 — Sharing & export

- [ ] Export the top-down layout to an image or PDF (a printable floor
  plan / blueprint view), distinct from the 3D walkthrough.
- [ ] Multiple save slots / named designs, beyond the current single
  localStorage autosave key.

## Phase 8 — Mobile & accessibility

- [ ] Touch controls for both the grid editor (pan/zoom/place already uses
  pointer events, which is a reasonable base) and walkthrough mode
  (`PointerLockControls` is desktop-oriented; touch-based look/move needs
  its own control scheme).
- [ ] Basic accessibility pass: keyboard-operable toolbar, focus states,
  labeled controls — consistent with the a11y baseline the rest of the
  toolkit uses elsewhere in this org's tools.

## Suggested build order

Phases 1 through 4 are done, and with them every structurally invasive piece:
the model now says everything a building needs it to say. **Walkthrough
collision (Phase 5) comes next** — it's the one remaining item that changes how
the tool *feels* rather than what it can describe, and everything it needs is
in place: polygon walls are line segments, props have footprints, railings mark
the edges you shouldn't walk off, and `floorCuts()` already knows where the
floor isn't. Falling versus blocking at an edge is the only open design
question in it.

Polish phases (6-8) are ongoing, pick up opportunistically. Several got cheaper
along the way: `shapeArea()` is most of the measurement readout Phase 6 wants
(the Shape tool already reports ft² in the status bar), rooms and props both
have an *object* for multi-select and copy/paste to work with, and Phase 7's
printable floor plan now has a second storey and a stair symbol to draw — worth
sketching what a plan view should show before building it.
