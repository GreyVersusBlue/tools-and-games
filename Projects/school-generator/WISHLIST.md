# School Generator — Feature Wishlist

Living reference for where this tool goes next. The v1 model (merged in #38)
was a single-floor, grid-based editor + first-person walkthrough: rectilinear
rooms only, no furniture, no multi-story. **Phases 1 through 3 have since
landed** — the state is multi-floor, rooms can be arbitrary polygons, and
there's a furnished prop layer with a catalog, a placement tool and instanced
rendering (see those sections for what was decided and what it means for the
phases below). This document breaks down the remaining improvements — stairs,
mezzanines, glass walls, walkthrough collision — into a rough build order, and
calls out where each one collides with assumptions baked into the current
code.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas
under the right phase rather than starting a second list.

## Current architecture, in brief

(`js/grid.js`, `js/shapes.js`, `js/props.js`, `js/catalog.js`,
`js/propplace.js`, `js/sample.js`, `js/editor.js`, `js/polyedit.js`,
`js/propedit.js`, `js/render.js`, `js/walkthrough.js`, `js/save-load.js`,
`test/model.test.mjs`, `test/shapes.test.mjs`, `test/catalog.test.mjs`,
`test/propplace.test.mjs`)

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
  way the room-color swatches drive the room tool. `state.links[]` still just
  holds inter-floor connections, unused until Phase 4. `assets/models/` is
  still an empty placeholder (`.gitkeep` only) — Phase 3 stayed procedural.
- **Rendering merges structure into a few big meshes, props into one
  `InstancedMesh` per type per floor.** Floor/wall/ceiling/fixture geometry is
  `mergeGeometries`'d per material, per storey, rebuilt from scratch on every
  edit — polygon rooms merge into the same meshes as the grid. Props are
  different: each catalog type's geometry is built once and cached, and every
  placed instance of it on a floor is one `InstancedMesh`, so a classroom's
  worth of desks costs one draw call rather than one `Mesh` each.
- **Walkthrough is no-clip.** `PointerLockControls` with WASD + fly up/down,
  no collision against walls, no stairs to walk up/down. It does spawn on the
  storey you were editing (in the biggest polygon room, if that storey has no
  grid cells), and the fly-up range covers the whole building.
- **Save format is versioned** (`version: 3`): floors (cells, edges, shapes) +
  props + links. `deserialize()` validates/clamps everything on load and
  migrates v1 and v2 files forward.

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

## Phase 4 — Architectural features

- [ ] **Stairs.** A placeable object (like a prop, but structural) that:
  - Connects two floors at specific (x, z) locations
  - Cuts a floor-opening polygon in the floor above (so you can see/walk
    up through it) — a floor cut is a hole in a polygon room, which Phase 2
    already models; what's missing is a stair that owns one
  - Blocks/guides walkthrough movement realistically (see Phase 6)
- [ ] **Mezzanine** — a partial second floor with an open edge overlooking
  the floor below:
  - A floor region that doesn't extend wall-to-wall, with a guardrail/
    railing along the open edge instead of a wall
  - Needs the floor-opening concept from stairs (the "look down" cutout)
  - Railings as their own renderable type — not quite a wall (partial
    height, often has balusters/glass panel) and not quite a prop
- [ ] **Glass walls / windows.** On the grid, walls are a binary
  `1 = wall / 2 = door` in `edgesH`/`edgesV`; on a polygon, `walls[i]` is
  already an enum with room in it (`2 = glass`, per Phase 2's note). Add glass
  to both with its own transparent/reflective material in `render.js`, and decide
  whether glass blocks the walkthrough flood-fill-style room boundary the
  same way solid walls do (it should visually separate rooms but likely
  still counts as a boundary for room detection).
  - Could extend to partial-height glass (interior half-wall with glass
    above) as a follow-up once the wall-type model supports more than a
    binary state.

## Phase 5 — Walkthrough mode improvements

- [ ] **Collision detection.** Walkthrough is currently no-clip
  (`walkthrough.js` moves the camera freely through walls). Once there are
  props to bump into and floors to fall off of, add basic capsule/AABB
  collision against walls and prop footprints.
- [ ] **Floor-to-floor navigation** via stairs once multi-floor + stairs
  exist — walking up a staircase should move the camera's floor/Y
  appropriately rather than just flying through geometry.
- [ ] **Falling off mezzanines / floor edges** — once there's an open floor
  edge, decide whether walkthrough mode should have basic gravity/fall
  behavior or just block movement at the edge (simpler, may be enough for
  the tool's purpose).
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

Phases 1 through 3 are done. **Architectural features (Phase 4) come next**:
the other structurally invasive piece, and the polygon model is now the thing
they sit on — a floor cut is a hole in a room, a railing is a segment with a
wall state that isn't "wall". **Walkthrough collision (Phase 5)** matters most
once there's something to collide with, which is true now on two counts —
polygon walls give it real line segments to collide against rather than a
lattice, and Phase 3 filled rooms with props to bump into — so it's reasonable
to fold in alongside or right after Phase 4. Polish phases (6-8) are ongoing,
pick up opportunistically. A few got cheaper along the way: `shapeArea()` is
the measurement readout Phase 6 wants (the Shape tool already reports ft² in
the status bar), and both rooms and props now have an *object* for
multi-select/copy-paste to work with rather than a plain-string coping.
