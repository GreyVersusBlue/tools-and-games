# School Generator — Feature Wishlist

Living reference for where this tool goes next. The v1 model (merged in #38)
was a single-floor, grid-based editor + first-person walkthrough: rectilinear
rooms only, no furniture, no multi-story. **Phases 1 through 5 have since
landed** — the state is multi-floor, rooms can be arbitrary polygons, there's a
furnished prop layer with a catalog and instanced rendering, the storeys are
joined (stairs that cut their own opening in the floor above, railed mezzanine
voids, glass walls on both room representations), and the walkthrough camera
now has a body: it collides with all of that, climbs the stairs, and stops at
the edge of a floor instead of walking off it (see those sections for what was
decided and what it means for the phases below). This document breaks down the
remaining improvements — editor polish, export, mobile — into a rough build
order, and calls out where each one collides with assumptions baked into the
current code.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas
under the right phase rather than starting a second list.

## Current architecture, in brief

(`js/grid.js`, `js/shapes.js`, `js/props.js`, `js/catalog.js`,
`js/propplace.js`, `js/stairs.js`, `js/collide.js`, `js/templates.js`,
`js/sample.js`, `js/editor.js`, `js/polyedit.js`, `js/propedit.js`,
`js/stairedit.js`, `js/templateedit.js`, `js/render.js`, `js/walkthrough.js`,
`js/save-load.js`, `js/blueprint.js`, `test/model.test.mjs`,
`test/shapes.test.mjs`, `test/catalog.test.mjs`, `test/propplace.test.mjs`,
`test/stairs.test.mjs`, `test/collide.test.mjs`, `test/templates.test.mjs`,
`test/blueprint.test.mjs`, `test/save-slots.test.mjs`)

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
- **The walkthrough camera has a body.** `PointerLockControls` with WASD, and
  a 0.9ft circle that walls, glass, railings and floor-standing furniture stop
  — doorways excepted. `js/collide.js` is the pure half of it: `wallSegments()`
  turns a storey (both room representations, openings cut out) into line
  segments, `supportAt()` says what surface is under a point (slab, stair
  tread, or the site outside), and `moveWalker()` resolves one step, sliding
  along a wall it can't go through and refusing one that would step off an
  edge. It spawns on the storey you were editing (in the biggest polygon room,
  if that storey has no grid cells); `F` drops the body for the old no-clip
  flight, which is still how you reach a storey with no stairs to it yet.
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

## Phase 5 — Walkthrough mode improvements ✅ *the movement half is done*

The phase that changes how the tool *feels* rather than what it can describe.
Everything it needed was already in the model: polygon walls are line segments,
props have footprints, railings mark the edges you shouldn't walk off, and
`floorCuts()` knows where the floor isn't. What was missing was something that
asked those questions once a frame — `js/collide.js`, pure and headless, the
same model/interaction split `shapes.js`/`polyedit.js` uses.

- [x] **Collision detection** (`js/collide.js`). The camera has a body: a
  0.9ft circle that walls, glass, railings and floor-standing furniture all
  stop. Doorways don't — a grid door's opening and a polygon wall's
  `{ seg, t, w }` openings both come out of `wallSegments()` as a hole in a
  run. Walking at a wall on the diagonal slides along it (the whole step is
  tried first, then each axis alone), and a step long enough to jump a wall
  outright is refused rather than resolved, so a stalled frame can't put you
  on the wrong side of one.
- [x] **Floor-to-floor navigation** via stairs — landed with Phase 4, since a
  staircase you can't walk up is a decoration. `stairUnder()` in `stairs.js`
  answers "what is under my feet, and how high is it there"; the camera takes
  the tread's height whenever it's within a band of it, so you climb a run by
  walking at it. Deliberately a ramp rather than 21 discrete steps: a
  first-person camera stepping up in 7in jumps reads as a stutter. Phase 5
  folds it into `supportAt()`, so a tread is now just one more kind of surface
  a walker can be standing on.
- [x] **Falling off mezzanines / floor edges** — decided: **the edge blocks
  you**, it doesn't drop you. See the decisions below for why. Gravity is in
  there (32 ft/s², terminal velocity, a 1.2ft jump on `Space`) but it only
  ever runs when you left the ground on purpose.
- [x] **Ghost mode** (`F`) — the pre-Phase-5 no-clip flight, kept rather than
  replaced. Inspecting a design from inside a wall is a legitimate thing to
  want from a floor-plan tool, and a building whose upper storey has no stairs
  yet has no other way up.
- [ ] Real PBR texture sets, per the upgrade path already documented in
  `assets/textures/README.md` (currently all procedural canvas textures). Not
  a code change so much as an asset one — the loader path is the easy half,
  and nothing else in this phase depends on it, which is why it's still here.

**Decisions made, since the rest of the list depends on them:**

- **A floor edge stops you rather than dropping you.** This was the wishlist's
  own open question, and the simpler answer is the right one for a design
  tool: a fall costs you the viewpoint you were inspecting, and off the
  outside of a building it leaves you in the car park hunting for a door. So a
  *grounded* walker is refused any step whose destination is more than
  `STEP_DOWN` (1.5ft) below their feet — the same test that keeps you from
  walking off a mezzanine keeps you from walking off the building. Gravity
  still exists, because "what happens when I jump, or when I drop out of ghost
  mode in mid-air" needs an answer, but you only ever leave the floor
  deliberately.
- **The walker is a circle, not a capsule.** A school is vertical walls and
  floor-standing furniture; the only thing a capsule would buy over a circle
  plus a height test is ducking under a table, which nobody wants to do in a
  floor-plan tool. The height test that *is* there is one line: a prop under
  0.75ft (a rug) is something you walk over, not into.
- **You collide with the storey you're standing on**, not with all eight.
  `storeyAt()` divides your feet by the floor height and deliberately floors
  rather than rounds, so climbing a run hands you to the level above exactly
  when you arrive at it — halfway up a flight you are still colliding with the
  stairwell you left.
- **Every boundary kind blocks, doorways excepted.** Glass is a wall you can
  see through and a railing exists precisely to stop you, so both are in the
  segment list beside drywall. This is the same "anything non-zero is
  something" rule `floodRegion` has followed since v1, and it means a new
  boundary kind blocks by default rather than being silently walk-through.
- **Openings are widened by exactly what collision inflates them by.** Walls
  are drawn as boxes centred on their segment, so collision runs against the
  segment inflated by half a wall thickness — which would close a 3ft doorway
  in from both sides. `solidSpans()` pulls each cut end back by the same
  amount, so the gap you aim at is the gap the renderer drew.
- **A floor opening's guardrails are collision too.** They're the one boundary
  that isn't in a floor's own data — `openingRails()` derives them per link —
  so `buildCollider()` asks for them separately. Without that you'd stop at
  the *edge* of a mezzanine void rather than at the rail a foot in front of
  it, which at that distance is an obvious clip.
- **The collider is built once, when walkthrough mode starts.** Editing can't
  happen while you're walking, so there is exactly one invalidation point.
  Per storey, lazily, and thrown away on exit.

**What that changed elsewhere:**

- **`js/walkthrough.js` splits in two.** It keeps the camera, the keys and the
  timestep; every geometric question moved into `collide.js` where it can be
  tested headless. The old fly-anywhere update loop survives verbatim as
  `updateGhost()`.
- **A walk HUD** (bottom centre) says which level you're on and which body
  you're in, because "why won't it let me through here" is much less puzzling
  when the answer *ghost mode is off* is on screen.
- **No save format change.** Phase 5 reads the model and adds nothing to it —
  a v4 file walks exactly as it saved.
- **`test/collide.test.mjs`** — 35 more `node --test` cases: span cutting,
  every boundary kind, a door a body actually fits through, prop obstacles and
  the rug that isn't one, push-out and inside corners, anti-tunnelling,
  support over slabs / holes / stairs / the site, the edge refusal and the
  mid-air exemption, opening guardrails, and two walks through the sample
  school that have to end against a wall.

## Phase 6 — Editor UX polish ✅ *done*

Polish, and — unlike the first five phases — genuinely optional: nothing here
changed the save format or what a building can describe, only how it feels to
build one. All four items turned out to lean on machinery earlier phases had
already built for a different reason.

- [x] **Layers panel** (bottom-right, `js/render.js`'s `layers`/`setLayers`) —
  four checkboxes: Structure, Furniture, Ghost floor below, Ghost floor above.
  The first two hide whichever half of the *current* storey you don't need to
  see (laying out furniture in a room with the walls hidden, or checking a
  wall run with the desks out of the way); the last two are what Phase 1's
  "ghost the floor below" default becomes once it's a choice instead of a
  constant — a design with something worth aligning to *above* the storey
  you're on can ghost that instead, or both, or neither.
- [x] **Measurement / dimension display** — no new data, since the wishlist's
  own guess was right: `floodRegion` already had the cell count, `shapeArea`
  already had the polygon math (Phase 2), so this was routing what already
  existed to the status line at the moment it's useful. A grid room reports
  its square footage the instant you flood-fill it with the Room tool, the
  same way a polygon room already did; a wall reports the length of the run
  you just built (a polygon segment's own length on the click that raises it,
  a grid stroke's running total in cells × 4ft on release, since one grid edge
  is always exactly one cell wide); the floor panel's per-storey line reports
  total square footage — cells plus every polygon room's `shapeArea()` — in
  place of the plain cell count it used to show.
- [x] **Room/prop templates** (`js/templates.js`, `js/templateedit.js`, `🏫
  Layout`, key 0) — a preset is a named list of catalog props at fixed offsets
  from a click point, stamped all at once the way `sample.js` hand-places
  Room 101's furniture. Three ship with the tool: Standard Classroom (rows of
  desks, a teacher's desk, a whiteboard, a shelf), Computer Lab Row (a single
  dense row along a wall), Reading Corner (rug, low shelf, floor lamp). Same
  interaction shape as the stairs tool — a footprint ghost, `R`/`⇧R` to turn
  it before you commit, click to place — because a template *is* a
  single placeable thing right up until the moment it lands, at which point
  it's just ordinary props the Furniture tool already knows how to move,
  rotate or delete one at a time.
- [x] **Whole-room-section multi-select, copy/paste, mirror/rotate**
  (`js/polyedit.js`'s Shape tool, `js/shapes.js`'s `rotateShape90`/
  `mirrorShapeX`/`translateShape`/`addShapeCopy`) — Shift-click adds a
  polygon room to the selection instead of replacing it; Delete removes every
  selected room, Ctrl+C/V/D copy, paste and duplicate them, and `R`/`⇧R`/`M`
  rotate 90° or mirror the selection around its combined bounding-box centre.
  Any prop sitting inside a selected room's footprint (`pointInShape`) rides
  along with it through every one of those operations, so "move this
  classroom's layout" is one selection and one keystroke rather than
  re-placing a room's worth of furniture by hand.

**Decisions made:**

- **Sections are a polygon-room thing, not a grid-room thing.** Phase 2 already
  drew this line — "a grid room is a label; a polygon room is an object" — and
  a Set of ids to rotate or duplicate needs an object on the other end of each
  id. A grid region has no id at all; it's cells sharing a flood-fill. The
  existing click-to-promote path (Shape tool → click a grid room → it's a
  polygon room now) is the on-ramp when a layout needs section-editing more
  than it needs the lattice, the same as it always was for freeform outlines.
- **Corner handles only show for a selection of exactly one.** Dragging a
  single vertex of a five-room selection has no sensible meaning, so a wider
  selection shows outlines only and answers to the whole-section operations
  instead — the vertex tool's per-corner editing and its section editing don't
  fight over what a drag means, because only one of them is ever listening.
- **A section's pivot is the selection's combined bounding box, not each
  room's own centre.** Rotating three rooms that make up one classroom wing
  has to turn them *as* a wing — pivoting each one individually would scatter
  them relative to each other. `sectionCenter()` in `polyedit.js` is one
  number for the whole gesture.
- **Reflection re-derives winding rather than tracking it.** `mirrorShapeX`
  transforms every point and then calls the existing `orientRing` to settle
  outer-CCW/hole-CW again — the same bookkeeping `reverseRing` already does
  correctly for `walls[]`/`openings[]`, reused instead of duplicated. A 90°
  rotation doesn't need it (rotation preserves winding), but gets the same
  call for free since `orientRing` is a no-op when the winding is already
  right.
- **A prop's own facing has to counter-rotate against its position.**
  `propplace.js`'s documented `rotationY` convention rotates a local point
  into world space the *opposite* way a plain `(x, z)` point rotates under
  the same angle (see the comment on `rotateShape90`/`rotatePoint90` in
  shapes.js) — so a prop caught inside a rotating section gets
  `rotationY -= φ` alongside the position transform, not `+= φ`, or the desk
  would spin the wrong way relative to the room turning around it. Verified
  in the browser, not just unit tests: a rotate/mirror/duplicate/undo pass on
  a room with a prop in it round-trips exactly, checked interactively before
  this shipped.
- **A template places ordinary props, not a new kind of object.** There's no
  "template instance" in the save format — `templatePlacements()` returns
  the same `{ type, x, z, y, rotationY, mount }` shape `addProp` already
  takes, so a stamped classroom is indistinguishable from one built by hand,
  and needs no new save-format version, migration, or renderer path.
- **No save format change.** Every Phase 6 feature reads the existing model
  (props, shapes, floors) and writes through the existing mutators (`addProp`,
  `addShapeCopy`, `rotateShape90`, …) — a v4 file behaves exactly the same
  before and after this phase, and the layers panel's state lives in the
  renderer, not the design, the same way the current tool or the walkthrough
  camera aren't part of a save either.

**What that changed elsewhere:**

- **`js/render.js`'s `applyFloorVisibility` reads a `layers` object** instead
  of hardcoding "ghost the floor below, show props only on the current one".
  The defaults reproduce the old hardcoded behavior exactly, so a first run
  of the updated tool looks identical to before anyone touches a checkbox.
- **`js/editor.js` gained a fourth interactive tool module** (`templateedit.js`,
  alongside `polyedit.js`/`propedit.js`/`stairedit.js`) and two more
  Ctrl-combo entry points (`shapeCopy`/`shapePaste`/`shapeDuplicate`,
  parallel to the prop tool's) — `main.js`'s Ctrl+C/V/D handlers now try the
  prop tool's clipboard first and the vertex tool's section clipboard second,
  since exactly one of the two is ever the active tool.
- **`test/shapes.test.mjs`** — 7 more `node --test` cases for the transform
  primitives (translate, rotate, mirror, round-trip winding and area, the
  per-floor cap on copies). **`test/templates.test.mjs`** — a new suite
  checking every template stamps only real catalog types, keys don't
  collide, and placement composes rotation correctly.

## Phase 7 — Sharing & export ✅ *done*

- [x] **Export the top-down layout to an image or PDF** (`js/blueprint.js`,
  🖨 Export in the top bar) — a printable floor plan / blueprint view, built
  from scratch rather than screenshotting the editor's own 3D top-down
  camera (see below for why). Architectural-style symbols: walls drawn by
  kind (solid/glass-dashed/railing-dotted), a door leaf + quarter-circle
  swing at every opening (grid door or polygon doorway alike), a
  tread-and-arrow stair symbol for a run placed on the floor you're
  exporting and a dashed "OPEN BELOW" hole for the floor a stair from below
  cuts into, room labels with square footage, a dimension line for the
  building's overall width and depth, a scale bar, a north arrow and a title
  block. "This floor" or "All floors", with dimensions and furniture as
  independent toggles.
  - **PNG** downloads straight off an offscreen canvas per floor
    (`renderFloorPlanCanvas` + `downloadCanvasPNG`).
  - **PDF** goes through the browser's own print pipeline rather than a
    hand-rolled PDF writer: each selected floor's canvas becomes a
    full-page `<img>` in a normally-hidden `#print-area`, `@media print`
    hides everything else, and `window.print()` opens the OS "Save as PDF"
    path every browser already has. No new dependency, and nothing to
    vendor into `libs/`.
- [x] **Multiple save slots / named designs** (`js/save-load.js`, 🗂 Designs
  in the top bar) — a small localStorage index of `{ id, name, updatedAt }`
  plus one JSON blob per slot (`saveDesign`/`loadDesign`/`deleteDesign`/
  `renameDesign`/`listDesigns`), sitting *beside* the single autosave key
  rather than replacing it. Save the current work under a name, come back
  later and load it, rename or delete it, or overwrite a slot in place —
  all without the file-download/upload round trip Save/Load already offered
  and still offer unchanged.

**Decisions made:**

- **The plan is computed from the model, not captured from the editor's
  own top-down camera.** The edit view's orthographic camera looks straight
  down on the *3D* scene — walls have height, doors are 3D cutouts, a stair
  run is a ramp of geometry — so a screenshot of it would show roofs and
  foreshortened stair treads, not a blueprint. `computeFloorPlan` reads the
  same cells/edges/shapes/props/links every other module does and turns
  them into flat, 2D architectural symbols instead, which is also what
  makes it unit-testable (`test/blueprint.test.mjs`) the way `render.js`'s
  3D geometry never has been.
- **A door's swing is a fixed hand, not a correct one.** Nothing in the
  model says which side of a wall is "the room" a door opens into — that's
  as true of a polygon wall's `{ seg, t, w }` opening as it is of a grid
  edge — so every swing arc opens 90° to the left of the wall's own
  direction. Consistent and readable beats guessing which side is right.
- **Polygon wall openings reuse `solidSpans` from `collide.js`** — the same
  cut-the-run-at-each-opening arithmetic the walkthrough collider uses —
  so a plan's door gaps are, by construction, exactly the gaps you can
  walk through in first person, not a second approximation of them.
- **A stair's own symbol and the hole it cuts are drawn from two different
  queries, same as the 3D renderer keeps them.** `linksFrom(state, floorIndex)`
  is the run placed *on* this floor (treads, direction arrow); `floorCuts(state,
  floorIndex)` is the hole *cut into* this floor by a run rising from the
  floor below. They never collide, so both draw unconditionally.
- **PDF is the browser's print dialog, not a hand-rolled writer.** The
  project has no build step and no vendored dependencies beyond three.js;
  adding a PDF-generation library (or writing a minimal one, which is very
  possible for image-only pages but still real surface area) would have
  been the first exception to that. Routing through `window.print()` with a
  `@media print` stylesheet gets the same "hand someone a PDF" outcome for
  free, using a path every browser already ships.
- **Slots are metadata beside the design, not a field inside it.** A save
  slot's name and timestamp live in a separate localStorage index
  (`SLOTS_KEY`) from the design JSON itself (`SLOT_PREFIX + id`), so listing
  saved designs never parses a whole design just to show its name, and nothing
  about the save-format version changes — a v4 file saved into a slot loads
  back exactly as `deserialize()` already reads it.
- **The single autosave key is untouched.** It's still exactly what you're
  looking at right now, restored on reload the same way it always was;
  slots are a library you save *into* deliberately, not a replacement for
  the safety net that already existed.
- **No save format change.** Both features read the existing model and the
  existing save file; a v4 design plans and slots identically before and
  after this phase.

**What that changed elsewhere:**

- **Two new top-bar buttons** (`🗂 Designs`, `🖨 Export`), each opening a
  full-screen modal styled the same way the walkthrough's start/exit
  overlay already was — the first modal-shaped UI in the app beyond that
  one, reusing its pattern rather than inventing a second one.
- **`test/blueprint.test.mjs`** — 12 `node --test` cases for
  `computeFloorPlan`: door gaps (grid and polygon), wall kinds, polygon room
  area/label, a stair's symbol vs. the hole it cuts on the floor above,
  floor-opening vs. staircase as distinct symbol kinds, catalog-driven
  furniture footprints (including an unknown type skipped rather than
  crashing), and bounds that grow to fit a room or prop hanging outside the
  grid footprint. **`test/save-slots.test.mjs`** — 10 more cases against an
  in-memory `localStorage` shim: create/list/load/rename/delete, overwrite
  vs. new slot, name trimming, and the slot-count limit.

## Phase 8 — Mobile & accessibility ✅ *done*

- [x] **Touch controls for the grid editor.** Placing/dragging with one
  finger already worked — pointer events don't distinguish touch from a
  mouse — so what was actually missing was panning and zooming, which the
  desktop build spends on a middle/right mouse button and a wheel, neither
  of which exists on a touchscreen. A second finger now pinch-zooms and pans
  the edit view; the first finger still drives whichever tool is selected.
- [x] **Touch controls for walkthrough mode.** `PointerLockControls` needs
  `requestPointerLock()`, which touch browsers don't reliably offer — so a
  touch-capable device skips it entirely in favor of an on-screen joystick
  (movement), drag-anywhere-on-the-canvas (look), and Jump/Sprint/Exit
  buttons, feeding the same `updateWalk()`/`updateGhost()` the keyboard path
  already had.
- [x] **Basic accessibility pass**: every icon-only button got an
  `aria-label`, every toggle-style button (tool, wall/stair kind, palette
  item, room swatch, FX) now carries `aria-pressed` kept in sync with its
  `.active` class, focus states are explicit (`:focus-visible`, since the
  dark panels swallowed the browser default), the three overlays are real
  dialogs (`role="dialog"`, `aria-modal`, focus moves in on open and back to
  the trigger on close), and the status line / walk HUD are `aria-live`
  regions so a screen reader hears what the mouse/keyboard already shows.

**Decisions made:**

- **Touch and mouse aren't simultaneous input paths on the same surface —
  they're chosen once, by device capability.** `touch.js`'s
  `isTouchCapable()` (checked once at load) decides whether the walkthrough
  offers Pointer Lock or the joystick/drag-look pair; a touch-and-mouse
  hybrid device (a touchscreen laptop) gets the touch flow, on the theory
  that Pointer Lock behind a touchscreen's glass is the less reliable of the
  two, not that mouse users are worse served — the on-screen joystick still
  drags fine with a mouse, only the look-by-dragging-the-canvas path is
  touch-only (see below). The editor makes the equivalent choice per
  *gesture* instead of per device, because unlike the walkthrough it has to
  keep working for a mouse at the same time: a touch pointerdown is what
  triggers the editor's pinch/pan state machine, a mouse pointerdown never
  does.
- **A tool click is held back briefly, not applied immediately, on the first
  finger down.** Two fingers of a pinch land somewhere around tens of
  milliseconds apart, not in the same event — so if the first finger's
  tool click fired the instant it touched down, a pinch would always draw
  one stray floor tile (or worse) before the second finger arrived to
  explain itself. `editor.js` holds a first touch in a `pendingTouch` state
  for up to 90ms (or until it moves more than a few pixels, so a real drag
  never feels delayed, or until it lifts, so a real tap still registers
  immediately on release) before committing it to whichever tool is active.
  If a second finger lands inside that window, the pending touch is
  discarded — nothing was ever applied, so there's nothing to undo — and
  both fingers become a pinch/pan gesture instead.
- **A tool interaction already under way is never interrupted by another
  finger.** Once a touch has committed to a tool (a stray palm, a second
  finger during an active drag), it's tracked but ignored rather than
  hijacked into a gesture — canceling a half-finished drag cleanly would
  mean reaching into whichever of poly/prop/stair/template's own gesture
  state happened to be live, which is exactly the kind of cross-module
  reach the tool split was built to avoid. The cost is that a slow,
  deliberate pinch that starts more than 90ms after the first finger
  touches down while that finger is already dragging won't be recognized as
  one — acceptable, since letting go and pinching fresh always works.
- **Pinch-zoom and two-finger pan are one calculation, not two.** Panning
  is nothing but "keep the world point under your fingers where your
  fingers are" applied every frame; zooming by the pinch-distance ratio and
  then re-deriving the pan correction from that same before/after
  raycast makes a translate-together gesture a pan for free, with no
  separate code path. The one subtlety it exposed:
  `raycaster.setFromCamera()` reads a camera's `matrixWorld` directly, which
  is normally only refreshed once a frame by the renderer right before it
  draws — moving the camera and immediately raycasting again, several times
  a gesture, needed its own explicit `camera.updateMatrixWorld(true)` or
  every "after" reading would still see the pre-move camera and the
  correction would silently be a no-op.
- **Touch-look drags the canvas directly; it doesn't reuse
  `PointerLockControls`.** That class computes its rotation from a locked
  pointer's `movementX`/`movementY`, which only exists once the pointer is
  actually locked — so touch has to do the same yaw/pitch math itself, from
  an ordinary drag delta instead. `touch.js`'s `lookEulerDelta()` is that
  math, factored out of `walkthrough.js` so it's the one piece of this phase
  that's pure and unit-tested (`test/touch.test.mjs`) rather than only
  exercisable from a real touchscreen.
- **The joystick and jump/sprint buttons don't invent a second movement
  model.** `walkthrough.js` already read `fwd`/`right` axes and a `keys` set
  built from WASD/Space/Shift; the joystick's `setMoveAxes()` feeds the same
  axes, and `touchKey()` lets the Jump/Sprint buttons add/remove from the
  same `keys` Set a keyboard would — so `updateWalk()`/`updateGhost()`
  needed no touch-specific branch at all, only the code that decides *which*
  input feeds them.
- **Ghost mode and PBR textures stay out of scope for touch.** Ghost's `F`
  key toggle has no on-screen equivalent yet — a touch session always walks,
  never flies — and the real-texture upgrade `assets/textures/README.md`
  already documented is unrelated to input at all. Neither blocks anything
  else here, so both are left as future, smaller additions rather than
  folded into this phase.
- **Focus return uses one slot, not a stack.** `openModal()`/`closeModal()`
  in `main.js` remember a single `document.activeElement` to restore focus
  to, which is correct for the common case (open a dialog, close it) and
  degrades to "focus doesn't move" rather than a crash in the one scenario
  it doesn't cover — tabbing past an un-trapped dialog into a control that
  opens a second one. A real focus trap (cycling Tab within the open dialog)
  would close that gap but is more than a "basic" pass needs; it's a
  reasonable next step if the overlays grow more content.
- **No save format change.** Every Phase 8 feature is input handling and
  markup — it reads and writes through the same tools, mutators and DOM the
  desktop build already had. A v4 file behaves identically before and
  after this phase.

**What that changed elsewhere:**

- **`js/touch.js`** is new — pure math with no DOM or three.js dependency,
  the same split `propplace.js`/`collide.js` already established:
  `isTouchCapable()`, `pinchZoomHeight()`, `joystickAxes()` and
  `lookEulerDelta()`. **`test/touch.test.mjs`** — 18 `node --test` cases
  covering all four: capability sniffing against a mocked
  navigator/window, zoom direction and clamping, the joystick's sign
  convention and unit-circle clamping, and the look delta's yaw/pitch sign,
  speed scaling and polar-angle clamping.
- **`editor.js`'s pointer handling split into `dispatchPointerDown`/
  `dispatchPointerMove`/`dispatchPointerUp`**, the exact logic the old
  inline mouse listeners had, now shared by both the mouse/pen path and the
  touch path's `commitPendingTouch()` — one implementation of "what a tool
  does with a pointer," fed from two different decisions about *when* to
  call it.
- **`walkthrough.js` gained a parallel input path** (`touchActive`,
  `moveAxes`, `touchKey()`, the canvas-drag look listeners) alongside the
  existing `PointerLockControls`-driven one, chosen once per walk session
  in `enable()`/`enableTouch()` rather than mixed per frame.
- **`index.html`/`main.js`**: a joystick, Jump and Sprint buttons, and an
  Exit button, shown only once a touch device actually starts walking
  (`body.touch-walk`, toggled alongside the existing `data-mode="walk"`);
  the walk overlay's copy swaps to touch-specific instructions and its
  button reads "Tap to Walk" instead of "Click to Walk" when
  `isTouchCapable()` says so at load. `main.js`'s new `openModal()`/
  `closeModal()` pair is now what all three overlays (walkthrough, designs,
  export) open and close through, in place of raw `classList` toggling.

## Suggested build order

Phases 1 through 6 are done: every structurally invasive piece, the one item
that changed how the tool *feels* rather than what it can describe, and the
editor-polish pass on top of it. The model says everything a building needs
it to say, you can walk the building it describes, and the editor itself
stopped fighting you while you build one.

Phase 7 is done too: a printable blueprint distinct from both the 3D editor
view and the walkthrough, and named save slots beside the single autosave.

Phase 8 is done as well: the grid editor pinch-zooms and pans, the
walkthrough offers a joystick and drag-to-look on a touch device instead of
Pointer Lock, and the editor chrome — every icon-only button, every
toggle-style control, the three overlays — carries the labels, pressed
states, focus styling and dialog semantics a keyboard or screen-reader user
needs. Nothing left on this list changes what the tool can describe; what
remains is polish, scale, and the kind of thing that's only worth doing once
someone's actually hit it.

A few smaller things this and Phase 5 left on the table, none urgent:

- A full responsive reflow of the editor's panels (toolbar, room/wall/prop
  panels, the floor and layers panels) for a phone-sized viewport is still
  future work — Phase 8 made the *canvas* usable by touch (pan, zoom, place,
  walk), not the surrounding chrome's layout on a narrow screen. The panels
  already scroll internally where they're tall (`#toolbar`,` #prop-panel`)
  rather than overflowing the viewport, which covers the worst case; a
  purpose-built compact layout is a separate, larger pass.
- Touch has no ghost-mode (no-clip flight) entry point — a touch session
  always walks. Desktop's `F` key toggle still exists underneath; giving
  touch its own button is a small, self-contained follow-up whenever a
  touch user actually needs to fly through a wall to check a design.
- The three overlays (walkthrough, designs, export) are real dialogs
  (`role="dialog"`, `aria-modal`, focus in on open and back to the trigger
  on close) but don't trap Tab within themselves — see Phase 8's own
  decisions above for why that's a reasonable line to stop at for now.

- `collide.js` is a linear scan over every wall on a storey, several times a
  frame. Fine at a school's scale (the sample's ground floor is a couple of
  hundred segments) and measurably fine at 60fps; if a design ever gets big
  enough to feel it, the fix is a uniform grid over the segment list, not a
  cleverer resolver.
- Nothing collides vertically. A walker is a circle with no height, so you can
  walk under a stair run and out the other side of it. Giving the body a head
  is a small change to `supportAt()`'s caller and a large one to what has to be
  in the segment list — worth doing only if headroom ever becomes the thing
  someone is using the tool to check.
