# School Generator — Feature Wishlist

Living reference for where this tool goes next. The v1 model (merged in #38)
was a single-floor, grid-based editor + first-person walkthrough: rectilinear
rooms only, no furniture, no multi-story. **Phase 1 has since landed** — the
state is multi-floor, there's a prop layer, and the save format is at v2 (see
that section for what was decided and what it means for the phases below).
This document breaks down the remaining improvements — polygon rooms, prop
placement, stairs, mezzanines, glass walls — into a rough build order, and
calls out where each one collides with assumptions baked into the current
code.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas
under the right phase rather than starting a second list.

## Current architecture, in brief

(`js/grid.js`, `js/props.js`, `js/editor.js`, `js/render.js`,
`js/walkthrough.js`, `js/save-load.js`, `test/model.test.mjs`)

- **One uniform grid, stacked floors.** A floor is a flat `cells[]` array
  (4ft cells) plus `edgesH[]`/`edgesV[]` arrays for walls/doors living
  *between* cells; `state.floors[]` stacks those on a shared footprint at
  12ft intervals. Everything is still axis-aligned to that grid — there's no
  concept of an angled wall or a non-grid-aligned point.
- **Rooms are a label, not a shape.** "Room" is just a flood-fill (`floodRegion`)
  over contiguous floored cells bounded by walls/doors, tagged with a name +
  color. There's no polygon, no room object with its own vertices.
- **A prop layer exists but nothing draws it yet.** `props.js` holds free-
  floating objects in world feet with ids, floors, rotation, scale and mount
  kind; `state.links[]` holds inter-floor connections. There is no catalog and
  no placement tool — that's Phase 3. `assets/models/` is still an empty
  placeholder (`.gitkeep` only).
- **Rendering merges everything into a few big meshes** (`mergeGeometries`
  per material, per storey: one floor mesh, one wall mesh, one ceiling mesh,
  one fixture mesh) rebuilt from scratch on every edit. Fine at grid scale;
  will need rethinking once there are hundreds of individually-selectable
  props.
- **Walkthrough is no-clip.** `PointerLockControls` with WASD + fly up/down,
  no collision against walls, no stairs to walk up/down. It does spawn on the
  storey you were editing, and the fly-up range covers the whole building.
- **Save format is versioned** (`version: 2`): floors + props + links.
  `deserialize()` validates/clamps everything on load and migrates v1 files
  into a one-floor v2 design.

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

Phase 1's prop layer is in place and empty — nothing renders props yet, and
there is no way to create one from the UI. That's this phase's job.

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

Phase 1 is done. **Props (Phase 3) come next**: lower-risk and highly
visible, they don't require touching the wall/room model at all, just the
prop layer that's now sitting there unused — and they're the thing that
validates that layer in practice before anything structural is built on it.
**Polygon rooms (Phase 2)** and **architectural features (Phase 4)** are the
biggest, most invasive pieces (new wall representation, floor openings) and
depend on each other, so tackle them together after props. Walkthrough
collision (Phase 5) matters most once there's something to collide with —
reasonable to fold in alongside or right after props. Polish phases (6-8) are
ongoing, pick up opportunistically.
