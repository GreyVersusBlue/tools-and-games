# School Generator — Feature Wishlist

Living reference for where this tool goes next. The v1 model (merged in #38)
is a working single-floor, grid-based editor + first-person walkthrough:
rectilinear rooms only, no furniture, no multi-story. This document breaks
down the requested improvements — polygon rooms, prop placement, stairs,
mezzanines, glass walls — into a rough build order, and calls out where each
one collides with assumptions baked into the current code.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas
under the right phase rather than starting a second list.

## Current architecture, in brief

(`js/grid.js`, `js/editor.js`, `js/render.js`, `js/walkthrough.js`,
`js/save-load.js`)

- **One uniform grid, one floor.** `createState(w, h)` is a flat `cells[]`
  array (4ft cells) plus `edgesH[]`/`edgesV[]` arrays for walls/doors living
  *between* cells. Everything is axis-aligned to that grid — there's no
  concept of an angled wall, a non-grid-aligned point, or a second story.
- **Rooms are a label, not a shape.** "Room" is just a flood-fill (`floodRegion`)
  over contiguous floored cells bounded by walls/doors, tagged with a name +
  color. There's no polygon, no room object with its own vertices.
- **No object/prop layer at all.** State is only floor cells + wall/door
  edges. `assets/models/` is an empty placeholder (`.gitkeep` only).
- **Rendering merges everything into a few big meshes** (`mergeGeometries`
  per material: one floor mesh, one wall mesh, one ceiling mesh, one fixture
  mesh) rebuilt from scratch on every edit. Fine at grid scale; will need
  rethinking once there are hundreds of individually-selectable props.
- **Walkthrough is no-clip.** `PointerLockControls` with WASD + fly up/down,
  no collision against walls, no floor concept to walk up/down between.
- **Save format is versioned but minimal** (`version: 1`): grid dims + cells
  + edges only. `deserialize()` already validates/clamps on load, which is
  the right pattern to extend rather than replace.

## Phase 1 — Foundational data model changes

These are prerequisites for almost everything below, so they come first even
though none of them are visible features on their own.

- [ ] **Multi-floor state.** Replace the single grid with a `floors: []`
  array (each floor = today's `{w, h, cells, edgesH, edgesV}`), plus a
  `currentFloor` index for editing and an inter-floor link table for stairs.
  Decide whether floors share one footprint/grid origin (simplifies
  aligning stairs/mezzanine openings) or are independent.
- [ ] **A generic object/prop layer**, separate from the cell grid:
  `props: [{ id, type, floor, x, z, rotationY, scale, ...type-specific }]`.
  Free-floating (x, z) in feet, not grid-snapped by default, so furniture
  can sit anywhere — with optional snap-to-grid / snap-to-wall as an editor
  aid, not a data constraint.
- [ ] **Save format version bump + migration.** `deserialize()` in
  `save-load.js` already has the right shape for this — extend it to accept
  `version: 2+`, default-fill `floors`/`props` when loading a v1 file, and
  keep old saves loading forever.
- [ ] Decide the **undo/redo strategy** once state includes floors + props —
  current `snapshot()`/`restore()` just JSON-clones the whole state, which
  still works but will get slower as prop count grows. Revisit if it becomes
  a problem; don't pre-optimize.

## Phase 2 — Polygon room editor

The most structurally invasive item on the list, since today a "room" isn't
a shape at all.

- [ ] Freeform polygon drawing tool: click to place vertices, close the
  loop, optionally snap to the grid or to existing wall edges (so polygon
  rooms can still butt cleanly against grid-built ones during the
  transition period).
- [ ] Support **non-rectangular rooms** for breakout rooms, alcoves,
  angled corners — walls no longer restricted to the 90°/grid-aligned
  edges `edgesH`/`edgesV` assume.
  - This likely means walls become a list of line segments (or the polygon
    boundary itself) rather than indices into a fixed edge array — a real
    schema change, not an incremental extension of `grid.js`.
- [ ] Room-in-room / carved alcoves: a polygon with a notch, or a small
  polygon subtracted from a larger one.
- [ ] Vertex editing after the fact (drag a corner, insert/delete a vertex)
  — reuse the drag-handle interaction patterns other tools already have
  before inventing a new one.
- [ ] Migration path for existing rectilinear rooms: either keep the grid
  system as "fast rectangular mode" alongside polygons, or auto-convert
  grid rooms to polygons under the hood so there's one room representation
  in the end. Worth deciding explicitly rather than accreting two systems.
- [ ] Flood-fill labeling (`computeLabels`) needs a polygon-aware
  equivalent, or rooms become explicitly-bounded polygons from the start
  and labeling is just "which polygon is this" instead of a fill.

## Phase 3 — Prop / furniture placement

Depends on Phase 1's prop layer.

- [ ] **Prop catalog** — a data-driven list of placeable types, each with a
  category, footprint (for collision/snapping), and default rotation:
  - Desks: student desk, teacher desk
  - Seating: student chair, teacher chair
  - Storage: file cabinet, bookshelf (full-height), bookshelf (half-height/
    low), cubby unit
  - Fixtures: lamp/floor lamp, TV / interactive smart board (wall-mounted —
    needs a "attach to wall" placement mode, not just floor placement)
  - Whatever else comes up in use (rugs, trash cans, sinks, whiteboards —
    keep the catalog easy to extend rather than hardcoding a fixed set)
- [ ] **Placement tool**: pick a prop from a palette (parallel to the
  existing room-color swatch panel), click to place, drag to reposition,
  rotate (keyboard modifier or handle), delete.
- [ ] **Snapping**: to grid, to wall (for wall-mounted items like TVs and
  smart boards), and to other props (align two desks in a row).
- [ ] **Geometry source**: v1 procedural boxes/primitives (fast, matches the
  current procedural-texture approach in `render.js`) vs. glTF models
  dropped into `assets/models/` (currently empty). Recommend starting
  procedural for shape variety at low effort, and treating `assets/models/`
  as a later upgrade path — same tradeoff the project already made for wall/
  floor textures per `assets/textures/README.md`.
- [ ] **Rendering at scale**: once a classroom has 30+ desks/chairs,
  per-prop `Mesh` objects will hurt perf compared to the current merged-
  geometry approach. Plan for `InstancedMesh` per prop type from the start
  rather than retrofitting later.
- [ ] Multi-select + copy/paste for props (place one desk row, duplicate it).

## Phase 4 — Architectural features

- [ ] **Stairs.** A placeable object (like a prop, but structural) that:
  - Connects two floors at specific (x, z) locations
  - Cuts a floor-opening polygon in the floor above (so you can see/walk
    up through it) — ties into Phase 2's polygon support for floor cuts,
    not just room walls
  - Blocks/guides walkthrough movement realistically (see Phase 6)
- [ ] **Mezzanine** — a partial second floor with an open edge overlooking
  the floor below:
  - A floor region that doesn't extend wall-to-wall, with a guardrail/
    railing along the open edge instead of a wall
  - Needs the floor-opening concept from stairs (the "look down" cutout)
  - Railings as their own renderable type — not quite a wall (partial
    height, often has balusters/glass panel) and not quite a prop
- [ ] **Glass walls / windows.** Currently walls are a binary
  `1 = wall / 2 = door` in `edgesH`/`edgesV`. Add a `3 = glass` (or a
  richer wall-type enum once Phase 2 moves walls off the edge-array model)
  with its own transparent/reflective material in `render.js`, and decide
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

Phase 1 unblocks nearly everything else, so it goes first regardless of
which visible feature is most exciting. After that, **props (Phase 3)** are
lower-risk and highly visible — they don't require touching the wall/room
model at all, just the new prop layer. **Polygon rooms (Phase 2)** and
**architectural features (Phase 4)** are the biggest, most invasive pieces
(new wall representation, floor openings) and depend on each other, so
tackle them together once props have validated the Phase 1 data model in
practice. Walkthrough collision (Phase 5) matters most once there's
something to collide with — reasonable to fold in alongside or right after
props. Polish phases (6-8) are ongoing, pick up opportunistically.
