# School Generator — Feature Wishlist

Living reference for where this tool goes next. The first arc of this project
— eight phases, from a single-floor grid editor to a multi-story, furnished,
polygon-roomed building you can blueprint, save, and walk through on desktop
or touch — is **done**, and so is the whole of the second arc: Phases 1
through 10, from a real furniture catalog through doors, light, sound, the
site, a living crowd, analysis, the generator that earned the tool its name,
the sharing that took it out of the tab it was drawn in, and the nav mesh that
made every number it prints true. Everything checked off below has shipped,
bar two items — one small one in Phase 1 that Phase 11 needs and carries, and
real-time collaboration, which needs a server and says so.

This document is now three things: a compact retrospective of that v1 build
(what shipped, what worked, what fought back, what a future builder needs to
know), the same treatment per phase for the second arc, and one open band for
everything after it — **Phase 11, where it gets fun to be in**.

Not a spec — a scoped list to pull from and refine before starting each
piece. Check items off (or strike them) as they land, and add new ideas under
the right phase rather than starting a second list.

## The v1 build, in retrospect

### Architecture that emerged

(`js/grid.js`, `js/shapes.js`, `js/props.js`, `js/catalog.js`,
`js/propplace.js`, `js/stairs.js`, `js/collide.js`, `js/templates.js`,
`js/touch.js`, `js/sample.js`, `js/editor.js`, `js/polyedit.js`,
`js/propedit.js`, `js/stairedit.js`, `js/templateedit.js`, `js/render.js`,
`js/walkthrough.js`, `js/save-load.js`, `js/blueprint.js`, `js/main.js`,
plus a `node --test` suite per pure module in `test/`. Phase 2 of the
second arc adds three more pure modules on the same terms —
`js/openings.js` (door leaves, swing, window bands), `js/walls.js`
(derived wall thickness) and `js/finish.js` (floor material, wall paint).
Phase 3 adds two more — `js/sky.js` (solar position, the sky palette, the
environment record) and `js/lights.js` (which props emit, and the clustering
and cap that decide which of them the GPU actually carries) — plus the one
piece of this arc that isn't a module or a tool: a hand-written
`libs/addons/postprocessing/DepthOfFieldPass.js`. Phase 4 adds two pure
modules and one impure one: `js/acoustics.js` (the room under a point, its
volume, its absorption and its Sabine reverberation time) and `js/sound.js`
(which props make a noise, how loud it is at the ear, and the voice budget),
with `js/audio.js` holding the Web Audio graph the way `render.js` holds the
three.js one. Phase 5 adds `js/terrain.js`, `js/site.js` and
`js/roof.js` — the ground, what is drawn on it, and what covers the building —
plus `js/siteedit.js`, the first tool that edits something which is not a room.
Phase 6 adds the three that put people in it: `js/navgraph.js` (rooms as hubs,
doorways as portals, stairs as links, and A* over the lot), `js/schedule.js`
(the school day as five numbers, the blocks they imply, and the bells that mark
them) and `js/agents.js` (a seeded population with timetables, steered by the
graph and resolved by `collide.js`'s walker). Phase 7 adds five that store
nothing at all — `js/occupancy.js` (what a room is for, and how many people
that allows), `js/egress.js` (how far to the door, how wide the door is, and
what a wheelchair can reach), `js/daylight.js` (glass over floor),
`js/takeoff.js` (what the building is made of) and `js/report.js` (all of them
at once, sorted worst-first) — plus one panel and no new save version, because
an analysis is a reading of the model rather than a part of it. Phase 8 adds
six more and the first save bump in two phases: `js/program.js` (how many
rooms of what kind a school for N students needs), `js/brief.js` (a sentence
read into that program by a phrase table, with no model behind it),
`js/generate.js` (where those rooms go, as a spine with wings),
`js/autofurnish.js` (which layout a room's own name asks for),
`js/shadow.js` (what an upper storey is standing on) and `js/overlay.js` (a
tracing image under the plan, scaled by measuring something on it) — plus
`js/overlayedit.js`, the tool that drags and measures it, and save v9, which
is the first version to carry something measured in megabytes. Phase 9 adds
six more and no dependencies: `js/gltf.js` (glTF 2.0, read and written by
hand), `js/models.js` (an imported file wearing a catalog row), `js/share.js`
(a design deflated into a URL fragment), `js/tour.js` (a recorded camera path
and the curve through it), `js/minimap.js` (the arithmetic between a floor
plan and a thumbnail) and `js/xr.js` (the rig, the sticks and the snap turn) —
plus save v10 and one new seam in `catalog.js`, a registry that lets a
design's own rows answer `catalogEntry` beside the built-in table. Phase 10
adds exactly one — `js/navmesh.js` (a room's floor, cut into convex tiles) —
and spends the rest of itself inside files that already existed: `navgraph.js`
stands on the mesh instead of on a hub per room, `generate.js` grows two more
schemes and an adjacency pass, `brief.js` two more tables, and `minimap.js` a
reader that turns a report into marks. No save bump, because a mesh is derived
and a brief is transient.)

- **Units are feet, everywhere.** 4ft grid cells (`CELL`), 10ft walls
  (`WALL_H`), 12ft floor-to-floor (`FLOOR_H`), max 8 storeys. Props, polygon
  vertices and the walker all live in world feet with sub-cell precision.
- **Two room representations, side by side.** The cell grid is the fast
  rectangular mode: `cells[]` plus `edgesH[]`/`edgesV[]` for walls/doors
  between cells. `floor.shapes[]` holds polygon rooms — rings of points in
  world feet, any angle, with holes, per-segment walls and `{seg, t, w}`
  doorways. A grid room is a flood-fill label; a polygon room is an object
  with an id. `convertRegion()` promotes the first into the second, per room,
  on demand.
- **Props are a free layer beside the grid** (`props.js`): `{ id, type,
  floor, x, z, y, rotationY, scale, mount, data }`. `type` is an open string;
  `js/catalog.js` gives it meaning (footprint, mount, geometry key) and
  unknown types survive save round-trips untouched. `mount` is
  `floor | wall | ceiling`.
- **`state.links[]` joins the storeys.** A stair or a plain opening stands on
  `from`, arrives at `from + 1`, and *computes* its hole in the slab above
  and ceiling below — nothing is baked into cells or rings, so moving or
  deleting a link restores the floor for free. Stair dimensions are derived
  from riser/tread constants and `FLOOR_H`, never chosen.
- **A boundary has a kind**: none / wall / door / glass / railing on the
  grid, `SEG_*` equivalents on polygon segments. Anything non-zero bounds a
  room for flood-fill and blocks the walker; only the renderer and blueprint
  care which kind. Unknown kinds load as solid wall, not as a gap.
- **Rendering merges structure into a few meshes per storey and props into
  one `InstancedMesh` per (floor, type)**, with per-type geometry built once
  and cached (`sharedGeo`). One vertex-colored material covers every prop.
- **The walkthrough camera has a body**: a 0.9ft circle resolved by
  `collide.js` (pure, headless) against walls, glass, railings, furniture
  and floor edges; `supportAt()` answers slab/tread/site — and since Phase 5
  of the second arc "site" is a lookup into a heightfield rather than a
  constant zero — stairs walk as ramps, `F` toggles the old no-clip ghost. Touch devices get a joystick +
  drag-look instead of Pointer Lock. Since Phase 6 the same body resolver runs
  for a whole school at once: an agent is this walker with a timetable instead
  of a keyboard, and the camera is one body in the crowd rather than the only
  one in the building.
- **Saves are versioned** (v9 as of Phase 8 of the second arc) and every bump
  has been additive, with `deserialize()` clamping hostile input and migrating
  every earlier version forward. v9 is the first one that is not free: an
  `overlay` carries an image as a data URL, so a design with tracing paper in
  it can be large enough that localStorage refuses it — which is why
  `serialize` takes `{ omitOverlay }` and the autosave retries without it. Named
  save slots live beside a never-renamed autosave key; blueprint export
  (`blueprint.js`) recomputes 2D plans from the model rather than
  screenshotting the 3D view.

### What shipped, per phase

1. **Foundations** — multi-floor `state.floors[]` on a shared footprint, the
   prop/link data layer, save v2 + migration, floor panel.
2. **Polygon rooms** — draw/edit freeform rooms with holes, snapping,
   per-room grid→polygon conversion, save v3.
3. **Furniture** — 14-type catalog, palette placement tool, three-tier
   snapping (wall / neighbor-row / 2ft lattice), procedural geometry,
   instanced rendering, multi-select and copy/paste.
4. **Architecture** — walkable stairs that cut their own openings, mezzanine
   voids with auto guardrails, glass curtain walls, save v4.
5. **Walkthrough** — collision, gravity and jumping, stair climbing, edge
   refusal instead of falling, ghost mode kept, walk HUD.
6. **Editor polish** — layers panel, live measurements, room layout
   templates, whole-section select/rotate/mirror/copy with props riding
   along.
7. **Sharing** — architectural blueprint export to PNG and print-pipeline
   PDF, named localStorage save slots.
8. **Mobile & accessibility** — pinch/pan editing that can't misfire the
   active tool, touch walkthrough (joystick, drag-look, on-screen buttons),
   aria labels/pressed states, real dialogs, focus-visible styling.

### What went well

- **Pure module + `node --test` twin.** Every geometric question
  (`shapes.js`, `propplace.js`, `stairs.js`, `collide.js`, `blueprint.js`,
  `touch.js`) lives in a headless module with its own suite — no build step,
  no deps — and the interactive tools stay thin. This is the single most
  load-bearing habit in the codebase.
- **Additive save versions, unchanged autosave key.** Four format bumps and
  nobody ever lost an in-progress design; an old file is just a design with
  none of the newer things in it.
- **Computed, not baked.** Stair cuts, guardrails, blueprint symbols and
  collision segments are all derived from the model on demand. Undo, moves
  and deletes need no special cases because nothing mutates neighboring data.
- **Catalog as data, `type` as open string.** Adding a prop is adding a row;
  newer saves survive older code.
- **Instancing from day one.** A classroom of desks is one draw call; prop
  count has never been a rendering problem.
- **Deriving instead of exposing.** Stairs have one knob (width); everything
  else re-proportions from `FLOOR_H`. Fewer knobs, no invalid states.
- **Reusing one implementation across features** — `solidSpans()` serves
  collision *and* blueprint door gaps, so the gap you walk through is the
  gap the plan draws, by construction.

### What fought back

- **Two room representations is a standing tax.** Every shared tool (wall,
  door, erase, measurements, blueprint, collision) handles both forever.
  It's the right trade — the lattice is genuinely faster for rectangles —
  but it's paid on every new feature.
- **Grid rooms have no identity.** Being a flood-fill label, not an object,
  blocked section-editing until rooms were promoted to polygons; anything
  that needs "this room" by id needs the polygon form.
- **JSON-clone undo is O(design).** Fine so far; will eventually need
  deltas if prop counts grow 10×.
- **Small three.js landmines cost real debugging time**: baking a bare
  `'#rrggbb'` string into a color buffer silently writes NaN
  (`coloredGeo` now normalizes); raycasting right after moving a camera
  needs an explicit `camera.updateMatrixWorld(true)` or the pinch-zoom
  correction reads a stale matrix.
- **The prop rotation convention counter-rotates against section
  rotation** (`rotationY -= φ` when the room turns by φ) — correct, tested,
  and still the least intuitive line in the transform code. Read the
  comments on `rotateShape90`/`rotatePoint90` before touching it.
- **Pointer Lock and touch don't mix.** The walkthrough needed a full
  parallel input path; capability is sniffed once at load, not mixed per
  frame.

### What was skipped, deliberately

- **PBR texture sets** — everything is still procedural canvas textures;
  the loader upgrade path is documented in `assets/textures/README.md`.
- **glTF models** — `assets/models/` is an empty placeholder; all prop
  geometry is procedural.
- **Vertical collision** — the walker is a circle with no head; you can
  walk under a stair run. Worth doing only if headroom checking becomes a
  real use.
- **Falling** — a floor edge blocks a grounded walker rather than dropping
  them; gravity only runs when you jump or leave ghost mode mid-air.
- **A spatial index for `collide.js`** — it's a linear scan per step, fine
  at school scale; the fix (a uniform grid over segments) is known if a
  design ever gets big enough to feel it.
- **Dialog focus traps, phone-width panel reflow, a touch ghost-mode
  button** — all small, all still open, none blocking.

### Considerations for future builders

- Keep the pure-module/tool split and add a test suite with every new
  geometric module. It's why this codebase stays debuggable.
- Save-format changes must stay additive, validated in `deserialize()`, and
  must never rename the autosave key. Unknown content survives; unknown
  boundaries default to *more* solid, not less.
- Every boundary kind blocks the walker and bounds flood-fill by default —
  new kinds opt *out* of solidity, never in.
- Ctrl-combo shortcuts route through `main.js`, not through the tools'
  generic key handling; tools only ever see Escape/Delete/Enter and friends.
- The walkthrough collider is built once at walk-start (editing and walking
  are exclusive) — anything that lets the world change mid-walk must
  invalidate it.
- Props: geometry builders return one merged, vertex-colored
  `BufferGeometry`, bottom at y=0, facing +Z, sized from the catalog row —
  keep that contract and instancing keeps working. One shared material;
  colors are baked per-vertex.
- The editor holds selection state in tools (resolved by id per use), never
  in saved state. Phase 8 added a second thing that belongs there and not in
  the file: whether overhangs are allowed. It is a decision about this editing
  session, and `shadow.js` reads the overhangs back off the geometry whenever
  anybody asks.
- A `PlaneGeometry` flattened with `rotateX(-π/2)` has its two extents in
  local **X and Z** — `scale.set(w, d, 1)` gives a plane one unit deep. Four
  ghost previews were wrong this way for two arcs before anybody noticed.
- Undo restores a snapshot with `Object.assign`, which only ever adds. Any
  *optional* record on the state (`terrain`, `site`, `roof`, `life`,
  `overlay`) has to be deleted when the snapshot doesn't have it, or undoing
  past the moment it was first written silently does nothing.

## Phase 1 — Prop catalog expansion (high fidelity, real scale) ✅

The catalog had 14 types — enough to prove the layer, nowhere near enough to
furnish a school. This phase made it a real furniture library: **~70 new
types**, every one at real-world dimensions, with a visible step up in
geometric fidelity while staying procedural and instanced. **Done** — in one
commit, ahead of every phase numbered after it, which is what let all of them
lean on it. One item is still open, at the bottom of the Principles list, and
Phase 11 picks it up.

### Principles

- [x] **Real scale, sourced.** 1 world unit = 1 foot, and every `w/d/h/y`
  comes from published furniture dimensions, not eyeball: a student desk top
  at 30in (2.5ft), chair seats at 16in, lockers 12in wide × 72in tall,
  counters at 36in, wall clocks at 12–14in dia. Wall/ceiling mounts respect
  the 10ft `WALL_H`.
- [x] **Scale-audit the existing 14 entries** against the same sources
  first, and correct any that drift (the current student desk reads slightly
  small; chairs slightly wide).
- [x] **Seating is never baked into a desk or table.** Student desks, long
  desks, round tables and lab benches are seatless objects; chairs and
  stools are their own types, so any seat pairs with any surface. Combined
  layouts — desk+chair pair, round table + 4 chairs, cafeteria table +
  benches — ship as **templates** (`js/templates.js`), which stamp ordinary
  separate props. (One deliberate exception: the outdoor picnic table, whose
  benches are structurally part of the object.)
- [x] **Fidelity goes up, the pipeline doesn't change.** Builders stay
  procedural, merged, vertex-colored and instanced — but the kit grows past
  boxes and cylinders: `LatheGeometry` (plant pots, globe stands, bin
  taper), `TorusGeometry`/tube segments (tube-steel chair frames, faucets,
  hoop rims), `ExtrudeGeometry` with bevels (table tops with eased edges,
  kidney/trapezoid tops from 2D outlines), `SphereGeometry` (globes, ball
  racks), higher radial segment counts where silhouette matters. Geometry is
  built once per type and shared, so a richer desk costs vertices exactly
  once — keep round parts at modest segment counts anyway.
- [x] **glTF stays the later upgrade path** (`assets/models/`, see Phase 9)
  — this phase is about how far procedural can go, which also keeps the
  no-build-step, no-asset-pipeline property.
- [x] **The palette has to scale.** ~85 types can't be one flat column:
  collapsible category groups and a text filter in `propedit.js`'s panel,
  same interaction bones as the existing palette. New categories are new
  strings in `CATEGORIES` (`catalog.js`) — proposed: Tables & Desks,
  Seating, Storage, Fixtures, Subject Rooms, Cafeteria, Gym & Stage,
  Library & Office, Restroom, Decor, Outdoor.
- [ ] **Color variants ride in `data`** (e.g. `data.color` overriding the
  catalog default) rather than as N near-duplicate rows — the field and its
  validation already exist; the builder cache needs a variant-aware key.
  **The one item of this phase that did not ship**, and the one Phase 11
  needs before it can put a seasonal palette on the Decor rows. Carried
  there; still lives here.

### New props, by category (dims in feet, at rotationY = 0)

- [x] **Tables & Desks:** double student desk (5 × 2 × 2.5h), seminar table
  6ft (6 × 2.5) and 8ft (8 × 3), round table 4ft and 5ft dia (2.4h),
  trapezoid table (5 × 2.5), kidney table (6 × 4), computer workstation
  (4 × 2.5, with monitor/keyboard on top), standing desk (4 × 2 × 3.5h),
  art table (5 × 3 × 2.9h), library study carrel (3 × 2 × 4h with privacy
  panels), folding cafeteria table (12 × 2.5 × 2.4h), science lab bench
  (6 × 2.5 × 3h, epoxy-black top, base cabinets, faucet), teacher
  podium/lectern (2 × 1.5 × 4h).
- [x] **Seating:** stackable chair (1.6 × 1.6 × 2.7h, tube-steel frame),
  rolling task chair (2 × 2 × 3h, five-star base), lab stool 24in and 30in
  (1.2 dia), hallway bench (6 × 1.25 × 1.5h), bean bag (2.5 dia × 1.3h),
  floor cushion (1.8 × 1.8 × 0.4h), lounge chair (2.8 × 2.8 × 2.6h), sofa
  (6 × 2.8 × 2.7h), auditorium seat (1.8 × 2 × 3.2h, row-snapping via the
  existing neighbor tier), rocking chair (2 × 2.5 × 3.3h).
- [x] **Storage:** locker bank, 6 doors full-height (6 × 1.25 × 6h) and
  half-height (12 doors in the same shell), tall supply cabinet
  (3 × 1.5 × 6h), coat rack (4 × 1.5 × 5.5h), rolling book cart
  (3 × 1.5 × 3.5h), double-sided library stack (3 × 2 × 5.5h), tote-bin
  rack (3 × 1.3 × 3h, colored bins), backpack hook rail (4 × 0.3 × 0.5h,
  wall, y 3.5).
- [x] **Fixtures:** wall clock (1.2 dia, y 7), cork/bulletin board
  (6 × 0.1 × 4h, y 3.5), pull-down projection screen (7 × 0.3 × 0.5h
  housing, y 7.5) + ceiling projector (1.5 × 1.2 × 0.5h, ceiling mount),
  glass trophy case (6 × 1.5 × 6.5h), water fountain + bottle filler
  (1.5 × 1.3 × 3.3h), fire-extinguisher cabinet (1 × 0.6 × 2.3h, y 3),
  AED cabinet (1.2 × 0.6 × 1.5h, y 4), exit sign (1 × 0.2 × 0.7h, y 7.5),
  PA speaker (1 × 0.8 × 1h, y 8), flag on wall bracket (angled pole +
  cloth, y 6), under-window radiator (4 × 0.8 × 2h), soap/paper-towel
  dispensers (small wall panels, y 4).
- [x] **Subject rooms:** upright piano (5 × 2 × 4h), music stand
  (1.5 × 1.5 × 4h), choir riser section (6 × 3 × 1.3h), artist easel
  (2 × 2 × 5.5h A-frame), drying rack (2.5 × 1.5 × 4h), kiln
  (2.5 × 2.5 × 3h), pottery wheel (2.5 × 2 × 1.8h), science demo table
  (8 × 2.5 × 3h), fume hood (4 × 2.5 × 8h), eyewash station
  (1.2 × 1.2 × 3.6h), anatomy skeleton on stand (1.5 × 1.5 × 5.8h),
  globe on stand (1.5 dia × 3h), 3D printer on bench (2 × 2 × 4h),
  robotics workbench (6 × 2.5 × 3h with pegboard), sewing machine table
  (4 × 2 × 2.5h).
- [x] **Cafeteria:** serving line counter (6 × 2.5 × 3h with sneeze guard),
  tray return (4 × 2 × 4h), milk cooler (3 × 2.5 × 3h), vending machine
  (3.3 × 2.8 × 6h, lit front), commercial fridge (4.5 × 2.7 × 6.8h),
  prep table (6 × 2.5 × 3h, stainless), trash + recycling station
  (4 × 2 × 3.5h, two-stream).
- [x] **Gym & Stage:** wall basketball hoop (6 × 3.5 backboard, rim at
  10ft — grazes a standard ceiling, so a real gym wants a two-storey room:
  an upper floor left open over the court, which the mezzanine machinery
  already supports; the entry should say so), folding bleacher section
  (8 × 7 × 5.5h, 3 rows), volleyball posts + net (30 × 1 × 8h), wall mat
  (6 × 0.2 × 6h, y 0), ball rack (4 × 2 × 3h with spheres), scoreboard
  (6 × 0.5 × 3h, y 6), stage platform section (8 × 4 × 2h, tileable).
- [x] **Library & Office:** circulation desk (6 × 2.5 × 3.2h), book
  display rack (2.5 × 1.5 × 5h, angled shelves), reception counter
  (6 × 2.5 × 3.5h, two-tier), waiting chair (as a type; rows via
  neighbor-snap), copier (2 × 2.3 × 3.8h), staff mail cubbies
  (3 × 1 × 3h, wall or counter).
- [x] **Restroom:** toilet with stall partition (5 × 3 × 5h, tileable into
  a row), urinal (1.5 × 1.2 × 2h, wall, y 1.3), two-basin sink counter
  (5 × 1.8 × 2.8h), mirror (4 × 0.05 × 3h, y 3.5), hand dryer
  (1 × 0.7 × 1.2h, y 3.5).
- [x] **Decor & Life:** potted plant, floor (1.5 dia × 4h) and desk
  (0.6 dia × 0.9h), aquarium on stand (3 × 1.3 × 4h), class pet cage
  (2.5 × 1.5 × 3h), poster (2 × 0.05 × 3h, y 4 — a few color/art
  variants via `data`), stacked books / paper-tray desk clutter
  (small, y placed on desks), coat + backpack on hook (0.3 deep, y 3.5),
  window blinds (4 × 0.2 × 0.8h housing, y 8).
- [x] **Outdoor:** picnic table (6 × 6 × 2.5h, integral benches — the
  documented exception), outdoor bench (6 × 2 × 2.8h), bike rack
  (6 × 2.5 × 2.5h), flagpole (1 dia base × 25h — taller than the building,
  fine on the site), playground slide (8 × 3 × 6h) and swing set
  (10 × 6 × 8h), basketball hoop on pole (4 × 4 × 12h), dumpster
  (6 × 3.5 × 4.5h), school-zone sign (1 × 1 × 7h).

### New templates alongside

- [x] Science Lab (benches + stools + fume hood + eyewash + demo table),
  Cafeteria Row (folding tables + benches or chairs), Library Aisle
  (double stacks + end display), Locker Hallway (banks along both walls),
  Gym (hoops + bleachers + volleyball + mats), Kindergarten Corner (kidney
  table + small chairs + rug + tote rack + rocking chair), Computer Lab
  (workstations + task chairs), Restroom (stall row + counter + mirror +
  dryer), Front Office (reception + waiting row + mail cubbies + copier).

### Decisions to make going in

- **Reuse geo kits before writing new ones.** Lockers are the cubby divider
  logic with doors; boards, mirrors, posters and signs are `panel` with
  parameters; many counters share one base-cabinet builder. Aim for ~20
  well-parameterized builders serving ~85 types, not 85 builders.
- **Builder contract is unchanged** — merged vertex-colored geometry,
  bottom at y=0, face toward +Z, sized from the row — so `propedit.js`,
  snapping, blueprint footprints and instancing all work for every new type
  with zero per-type code outside the builder table.
- **Blueprint symbols come free** from catalog footprints, but a handful of
  types deserve real plan symbols later (toilet, sink, stairs already have
  one) — note in `blueprint.js`, don't block on it.
- **`test/catalog.test.mjs` grows with the table**: uniqueness, category
  validity, sane dimension ranges (nothing taller than `FLOOR_H` unless
  flagged outdoor, wall mounts within `WALL_H`), every `geo` key resolved.

### How it actually landed

- **116 types in one commit**, across the eleven categories proposed above.
  The table has since grown to **155 rows and 13 built-in categories** —
  Phase 3 added Lighting, Phase 5 added Landscape, Phase 9 added Imported —
  which makes this the one phase that every later phase extended rather than
  merely used.
- **The reuse target was optimistic, and that is fine.** The plan was ~20
  well-parameterized builders for ~85 types; the reality is **83 builders for
  155 rows**. The collapse happened exactly where predicted — lockers,
  boards, mirrors, posters and signs are parameterized `cubby` and `panel` —
  and refused to happen in Subject Rooms, because a kiln and a fume hood
  share nothing but a floor. A builder per distinctive silhouette turns out
  to be the honest ratio.
- **Nine of the thirteen room templates are this phase's** — science lab,
  cafeteria block, library aisle, locker hallway, gym court, kindergarten
  corner, restroom, front office, music room. The seatless-surface rule is
  what let every one of them stamp ordinary props instead of special-casing
  furniture pairs, and it is the reason auto-furnish (Phase 8) could reuse
  them unchanged.
- **Shipping it first is why the rest of the arc reads the way it does.**
  WebXR lands convincingly (Phase 9) because a 6ft person is 6ft tall next to
  a 30in desk; occupant load and daylight (Phase 7) count real furniture; the
  generator (Phase 8) furnishes ninety rooms because there was something to
  furnish them with. The real-scale principle at the top of this section did
  more work than the type count.

## Phase 2 — Doors, windows & deeper building modeling ✅

The model says "opening"; a walker sees a gap. This phase makes the shell
believable up close. **Done** — save format v5, two new pure modules
(`js/openings.js`, `js/walls.js`) plus `js/finish.js`, and 271 tests.

- [x] Door leaves — an opening can carry a door (single/double, with lite,
  push bar for corridors) that swings open as the walker approaches and
  shows correctly in the blueprint's existing swing symbol.
- [x] First-class windows: a wall segment kind (or opening variant) with
  sill height, mullions and glazing — exterior walls stop being blank or
  all-glass. Blinds/curtains from Phase 1 mount into them.
- [x] Curved walls (arcs as polygon segments) — the biggest schema ask
  here; everything downstream (collision, blueprint, rendering) currently
  assumes line segments, so arcs should tessellate into segments at the
  model boundary.
- [x] Ramps and elevators as link types beside stairs — the accessible
  routes Phase 7 will want to check. An elevator is a link whose walkable
  answer is "teleport with doors"; a ramp is a stair with no risers.
- [x] Per-room finishes: floor material and wall paint on the room record,
  feeding both renderer and blueprint legend.
- [x] Wall thickness options (interior 0.4ft vs exterior 0.8ft) — collision
  and door-gap widening already parameterize on half-thickness, so this is
  plumbing a constant into a field.

*Collides with:* the boundary-kind enums (new kinds default to blocking —
good), `wallSegments()`/`solidSpans()`, blueprint symbol drawing, and the
"collider built once per walk" rule — an animated door is the first thing
that changes the world mid-walk, so doors need their own dynamic collision
path or a collider invalidation hook.

### How it actually landed

- **A window is an opening variant, not a segment kind.** The wishlist
  offered both; the variant won and paid for itself immediately. Position
  along a run, width, the plan symbol, the save validation, the tool that
  places one — all of it was already written for doorways. The entire
  difference between a window and a door is *one predicate*: `isDoorOpening`
  decides whether an opening becomes a gap in `wallSegments()`. That single
  line is what stops you strolling out of a second-storey classroom.
- **Wall thickness is derived, not stored** (`js/walls.js`). A wall with a
  room on both sides is a partition; one with open air on a side is
  exterior. Both answers are already in the model, so nothing records them:
  `walls.js` probes `floorSolidAt` either side of a run and hands back
  0.4ft or 0.8ft. No migration, no stale field, and drawing a new wing up
  against an exterior wall silently turns it into an interior one. Third
  time this codebase has taken that trade (after stair cuts and
  guardrails), and the cheapest of the three.
- **Curvature is an authoring act, not a field.** `curveSegment()`
  tessellates an arc into real vertices in place, so a curved wall is an
  ordinary polygon with a lot of corners and every downstream reader was
  already correct about it. What makes that survivable is `straightenRun()`
  — the wall tool keeps a memo of the arc it just laid down and flattens it
  back to the chord before re-bending, so adjusting a curve doesn't stack
  arcs on arcs. The memo is tool state, never saved state.
- **Doors were the only genuinely hard one**, and not for the reason
  expected. The dynamic collision path was easy: the collider stays built
  once, and gains a short list of leaves whose *current* segment is
  computed on demand rather than baked. The hard part was that a leaf
  swinging toward an approaching walker is unusable — `collide.js` pushes
  the body out of the leaf exactly as fast as the leaf sweeps into the
  body, and a door and a person shove each other back down the corridor.
  The fix is that **a door opens away from whoever approaches it**
  (`faceLeafAway`), which makes every door double-acting for the duration
  of a walk; the record's own hand is untouched and is still what the plan
  draws. A second rule — a leaf won't swing through a body already standing
  in its sweep — covers stepping into a door that is already moving.
- **v5 round-trips a v4 file byte for byte.** `writeOpening()` records only
  what differs from the v4 default, so a plain doorway is still
  `{ seg, t, w }` on disk. The one *behavioural* change is deliberate: an
  `EDGE_DOOR` that was a hole in a wall now hangs a leaf. A design that
  wants the hole back says `EDGE_OPENING`.

### What fought back

- **The lattice has nowhere to put options.** A polygon opening is a record
  and can carry a sill, a hand, a leaf count; a grid edge is an integer.
  So every variant the polygon side spells with fields costs the grid a new
  edge kind — `EDGE_WINDOW`, `EDGE_DOOR2`, `EDGE_OPENING` — and its width is
  fixed at the middle of the cell. Three kinds was tolerable; the next batch
  won't be. This is the two-representations tax again, and the first phase
  where it visibly bounded a feature rather than just costing work.
- **Door leaves can't be instanced.** Everything else on a storey merges
  into a handful of meshes; a leaf rotates independently, so it is one draw
  call each. Forty doors is forty draw calls — fine at school scale, and
  the geometry is still shared per (length, height, lite, bar).
- **`[` and `]` were already the floor keys.** The curve controls went to
  `,` and `.` rather than take them back.
- **A floor-to-floor ramp at 1:12 is 144ft of run.** That is the honest
  number and the tool prints it rather than quietly steepening the slope;
  the readout says outright that an elevator is the usual accessible route
  between storeys. See the deferred list below.

### Deliberately left for later

- **Switchback ramps.** A ramp here is one straight run, so the ADA-compliant
  version is 144ft long and rarely placeable indoors. Folding it into
  parallel legs with landings is the fix, and it needs a real walkable
  surface function (which leg, which landing, which direction) rather than
  the single linear one `stairSurfaceAt` uses now.
- **An elevator that moves.** The car teleports with `E`; there is no ride,
  no call button outside, and the doors are drawn parked open because a
  sliding door that shuts is a door you can't board. Phase 4's sound and
  Phase 6's schedule both want the animated version.
- **Re-editing a curve after a reload.** Curvature isn't stored, so the
  tool's memo only lasts as long as the tool does. Reopening a design and
  bending the same wall again starts from its chords.
- **Blinds and curtains mounting *into* a window.** Phase 1 shipped the
  props; they still sit against a wall at a height you pick rather than
  snapping to a window's sill and head.
- **Wall paint on the room's own side.** A wall is one object here, so a
  boundary between two painted rooms picks one colour (the lower hex, for
  stability). Painting each face separately means splitting wall geometry
  by side, which is a renderer change, not a model one.
- **Curved walls in the collider are chords**, so a walker feels the facets
  of a tight arc. At 2ft chords nobody has noticed.

## Phase 3 — Light, sky & atmosphere ✅

The fixed three-light rig becomes a sky with a sun in it. **Done** — save
format v6, two new pure modules (`js/sky.js`, `js/lights.js`), one new
post-processing addon, eleven new catalog rows, and 326 tests.

- [x] A sun with a position: date/time/latitude controls, real shadows,
  and a sun-study scrub (drag the hour, watch the light move through the
  Phase 2 windows).
- [x] Day/night cycle with dusk/night presets; the building's own lights
  take over after dark.
- [x] Placeable light fixtures that actually emit (classroom troffers,
  pendants, the existing floor lamp) — with a budget strategy, since
  three.js point/spot counts are finite: bake or cluster beyond a cap.
- [x] Photo mode: free camera, FOV/DoF controls, hide-HUD, one-click
  high-res capture (the blueprint's offscreen-canvas trick, aimed at the
  3D scene).

*Collides with:* the fixed three-light rig and single-pass material setup
in `render.js`; shadows × merged-mesh scale needs care (one shadow map, few
casters); the bloom/SSAO chain already in `libs/addons/` is the foundation,
not the obstacle.

### How it actually landed

- **The sun is real astronomy, and it was the cheap part.** Spencer's series
  for declination and the equation of time, the standard hour-angle
  altitude/azimuth pair, and the sunrise/sunset roots of the same equation —
  about eighty lines, no dependencies, accurate to a hundredth of a degree.
  A slider that just swings a light around would have been *more* code than
  this once it grew a sunrise marker and a "which way does this classroom
  face" answer. And it pays for itself immediately: the sun tracks low and
  south in January and high and long in June, sunrise drifts through the
  year, the panel can print *Sunrise 8:45 am · sunset 3:12 pm* at 58°N in
  December and be right, and Phase 7's "does this room get morning sun?" now
  has a number under it rather than a vibe.
- **The palette is keyed on the sun's altitude, not on the clock.** One
  seven-keyframe table serves a December afternoon in Oslo and a June
  morning in Quito with no special cases, because altitude is what the sky
  actually responds to. The `day` keyframe is *the Phase 2 fixed rig, to the
  digit* — same sky blue, same hemisphere and ambient levels, same warm sun —
  which is what makes the whole phase additive: the default environment
  resolves to it, so an old design opens looking exactly as it did and simply
  gains a clock you can now move. There is a test that holds those seven
  numbers in place.
- **v6 round-trips a v5 file byte for byte**, the same way v5 did v4:
  `serialize()` drops `env` entirely when it is the default. Fourth format
  bump, fourth time nobody loses anything.
- **Lighting is catalog data, and the output is in lumens.** A row with an
  `emit` block is a light; a row without one is furniture, however
  lamp-shaped. A 2x4 troffer says 4,000lm, a gym high bay 20,000, a
  parking-lot pole 12,000 — real product figures, converted to candela by
  the physics (`lm / 4π`) with exactly one artistic constant on the end.
  Phase 1 committed to real dimensions; there was no reason lighting should
  be the exception, and stating the fact rather than a taste made the
  brightness tuning a single number instead of eleven.
- **The budget is two stages and the first one does the work.** A classroom
  is eight troffers; as eight point lights that is eight times the cost for a
  result nobody can tell from one brighter light in the middle of the
  ceiling. So co-located fixtures cluster into one source at their
  lumen-weighted centroid, and only then does the nearest-`cap` ranking run.
  A hundred-fixture school comes out under twenty clusters. What doesn't make
  the cut isn't dropped: its lumens fold into a flat fill, which is the
  "bake" half of the strategy.
- **The pool is fixed-size, not grown on demand.** three.js compiles a shader
  program per light count, so a pool that resizes stalls on a recompile every
  time the walker turns a corner — the exact moment you least want a hitch.
  Twelve lights, allocated once, unused ones sitting at intensity 0.
- **Depth of field is ~130 lines rather than vendored.** three.js ships
  `BokehPass`, but this repo carries only the addons it uses, and the
  requirement here is narrower — one focus plane, one aperture, no bokeh
  shape. `DepthOfFieldPass` reuses the same "render the scene again into my
  own target for its depth" trick `SSAOPass` was already doing in that
  directory, and only exists while photo mode is open.
- **Fifth time this codebase derived instead of stored.** Wall thickness,
  stair cuts, guardrails, blueprint symbols — and now the sun's direction,
  the shadow frustum's size, whether the lights are burning, and which of
  them are real. The environment record holds six numbers a person chose;
  everything else in the lighting rig is computed from them on demand.

### What fought back

- **Turning a fill light's *intensity* up is not the same as making it
  brighter**, and that cost two rounds. The night ambient colour is nearly
  black by design, so raising its level produces a brighter shade of
  midnight blue and a corridor that is still a cave. It bit twice, and both
  fixes are colour changes rather than level changes: the building's own
  light now lives on a *second*, lamp-coloured ambient beside the sky's, and
  the editor's legibility floor pulls the fill's colour toward neutral as
  well as its level.
- **A floor plan at midnight is a correct picture and a useless drawing
  surface.** This is the one place the sun makes a concession to the tool:
  while editing, the fill never falls below a legible minimum and is pulled
  60% toward neutral, so the plan keeps the *colour* and the *shadows* of the
  hour without taking its darkness from it. The walkthrough gets no such
  help — standing in an unlit school at midnight is supposed to be exactly
  that.
- **`emissive` is a uniform and is not modulated by vertex colours.** Every
  prop in this build shares one material and carries its colour per vertex;
  a glowing lens can't. So a fixture's builder returns `{ body, lens }`
  instead of one geometry, the lens gets a material cached per lamp colour
  (the `finishMats` trick again), and both halves ride the *same* instance
  matrices — one loop, two meshes, so a lens can never drift from the light
  it belongs to. Without that, a green exit sign would glow warm white.
- **A lattice can't express "near".** The first clustering pass bucketed
  sources on a grid; a row of troffers 6in apart landed either side of a
  bucket line and came out as two clusters of four. A test caught it
  immediately. The replacement is a greedy sweep over a deterministically
  ordered list with a frozen seed per cluster — still stable frame to frame,
  which is the property that stops a light flickering between two positions
  as the camera moves, and it actually clusters.
- **The catalog test caught a wall pack hanging through the ceiling** before
  anything was rendered. The Phase 1 dimension rules are still earning
  their keep two phases later.
- **`Y` was free but `P` was crowded.** Photo mode needed the pointer
  *released* to reach its own sliders, which is the one unlock in the build
  that must not raise the walkthrough overlay over the controls you just
  asked for.

### Deliberately left for later

- **The generic ceiling troffers still don't emit.** Every other ceiling cell
  gets a baked 2x4 fixture; it glows on the same schedule as everything else
  but contributes only to the flat house fill, never a real light. That is
  the deliberate bake — a corridor reads as lit, a *placed* fixture reads as
  lighting something — and it is why the Lighting Bay template exists.
- **No shadows from the building's own lights.** Twelve shadow maps is not a
  school-scale budget, and a shadowless recessed fluorescent is a fair
  picture of a recessed fluorescent. A single shadow-casting "hero" light for
  photo mode is the obvious next move.
- **Spot lights.** `emit.kind` accepts `'spot'` and nothing renders one yet;
  every fixture is a point source, so a wall pack throws light up the wall
  behind it as happily as down at the ground.
- **Light doesn't respect geometry.** A cluster on the far side of a wall
  still reaches you if you're inside its radius — there is no occlusion test
  in the budget, only distance. At room scale it rarely shows; a long
  interior wall with a bright room behind it is where it will.
- **No moon, no stars, no clouds.** The night sky is a gradient. A moon is
  the same disc the sun already uses with a different phase and a much
  smaller intensity, which is a small job whenever it feels worth it.
- **Photo mode is desktop-only.** It hangs off `P` and a panel of sliders;
  touch has no key to press and no room for the panel.
- **The sun study doesn't animate itself.** You scrub the hour by hand.
  A play button that runs a day in ten seconds is a `requestAnimationFrame`
  and a stop condition away, and would make the feature demo itself.
- **Longitude and time zones.** The clock is local standard time at the
  design's own meridian — "10am where this building is" — with the equation
  of time applied so solar noon lands where it really does. There is nowhere
  to say *which* meridian, which is why sunrise here runs a few minutes off
  what a given town's almanac prints.

## Phase 4 — Sound ✅

The building makes a noise, and all of it is synthesized. **Done** — no save
format change at all (the first phase of either arc that needed none), two new
pure modules (`js/acoustics.js`, `js/sound.js`), one Web Audio module
(`js/audio.js`), five new catalog rows, eight `sound` blocks on rows that were
already there, and 366 tests.

- [x] The bell. Of course the bell.
- [x] Footsteps by surface (slab vs stair tread — `supportAt()` already
  knows), doors from Phase 2, ambient room tone.
- [x] Reverb sized to the room the walker is in — room identity and area
  exist (`floodRegion`/`shapeArea`); map volume to a convolver preset.
- [x] PA announcements and hallway ambience as placeable/ambient sources
  with distance falloff.

*Leans on:* the walker's existing surface and room queries; no save-format
change unless sources become placeable props (then they're just catalog
rows with a `data.sound`).

### How it actually landed

- **Not one audio file.** This was the decision the whole phase hung on, and
  it was settled by the constraints rather than by taste: no build step, no
  dependencies, no binary assets. A struck bell is seven inharmonic partials
  with different decay times; a footstep on terrazzo is a thump and a slap
  through a bandpass; a diffuser is noise through one resonance. That is a
  couple of hundred lines of oscillators, it weighs nothing, and — the part
  that matters — it can be *derived from the model* rather than matched to
  it. A sample library would have meant picking which of seven floor
  finishes got a recording. Synthesis meant all seven got a row in a table,
  the way every other material in this build does.
- **The reverb is Sabine's equation and nothing else.** RT60 = 0.049 V / A,
  imperial constant, published since 1898. The model already knew a room's
  plan area, and Phase 2 already put a real flooring product under it, so the
  only thing missing was an absorption coefficient per material — one column
  added to `FLOOR_FINISHES`, beside the colour and the plan hatch, because
  that is where "what this material is" already lives. There are no reverb
  presets, no zones to author, no `reverb: 'large'` field on a room. Walk
  from the carpeted media centre into the terrazzo stair hall and the tail
  triples because the arithmetic says it should.
- **Furnishing a room makes it quieter, and the tool can prove it.** Every
  prop's footprint and category were already in the catalog for Phase 1's
  reasons, so the sabins thirty desks and chairs contribute fall straight
  out. Then one new row — an acoustic wall panel at α 0.85 — turns that from
  a curiosity into a design tool: place two in the main hall, watch the
  number drop, delete them, watch it come back. The sample school ships with
  a pair on the hall wall for exactly that reason.
- **Because the number is real, it can be held to a real standard.**
  ANSI/ASA S12.60 asks for RT60 ≤ 0.6 s in a core learning space under
  10,000 ft³ and ≤ 0.7 s up to 20,000. So the panel doesn't say "lively", it
  says *0.84 s — Lively · over the 0.7 s limit*, and the editor-mode roll-up
  says *9 enclosed rooms · 8 over the ANSI limit*. Phase 7's "acoustics
  first pass, honest approximations labeled as such" arrived early and by
  accident, because the sound needed the same numbers anyway.
- **Levels are in dBA at three feet, because that is how the products are
  specified.** A ceiling diffuser is 38, a refrigerated fountain 52, a
  vending machine 55, a corridor gong 100. So the falloff is a law rather
  than a taste — −6 dB per doubling, which is a thing a test can check
  against arithmetic nobody has to read the function to verify — and there
  is exactly one artistic constant in the file, stated once: playback
  compresses, because the real 62 dB span from a diffuser to a bell does not
  fit through a laptop speaker.
- **Which props make a noise is catalog data**, the same way `emit` says
  which ones are lights. The pleasing part is how many of the rows were
  already there: a vending machine, a commercial fridge, a milk cooler, a
  refrigerated drinking fountain, a radiator, an aquarium, a wall clock and a
  PA speaker were all sitting in the catalog being silent. The phase added
  five rows and eight `sound` blocks, and most of the noise in a school
  turned out to already be modelled.
- **Sixth time this codebase derived instead of stored.** Wall thickness,
  stair cuts, guardrails, blueprint symbols, the sun's direction — and now
  the reverberation time, the pre-delay, the wet/dry split and which sources
  are worth a voice. Nothing about sound is in the save file. `serialize()`
  was not touched.
- **`AudioListener` from three, `PannerNode` by hand.** three's listener is
  worth having: it rides the walk camera, so the Web Audio listener's
  position and orientation come from the same transform the renderer draws
  from and nothing has to be kept in step. `PositionalAudio` is not, because
  every source here is a synthesized node graph rather than a buffer. Same
  call `DepthOfFieldPass` got in Phase 3.

### What fought back

- **A hall with an atrium down the middle of it is not two rooms.** The first
  ceiling probe answered per point: stand at one end of the sample school's
  main hall and it said "12 ft, tile ceiling"; walk to the middle, under the
  two-storey void, and it said "22 ft, open deck" — so the reverberation
  readout changed as you crossed a room whose volume had not changed at all,
  and the number tripled. A room has one volume, so it now gets one ceiling:
  the mean over a lattice of probes inside it, with the ceiling *material*
  mixed on the same evidence rather than picked by a threshold. A hall that
  is 6% open is 6% deck and 94% tile. The lattice is coarse enough to miss a
  light well the size of a desk, which is the intended trade.
- **Distance was very nearly applied twice.** The budget's dB math and the
  PannerNode's own inverse-square law are both correct and doing them both
  makes everything past thirty feet vanish. The split that survived: the dB
  math decides *which* sources are worth a voice and what the panel prints,
  and the panner decides how loud each one is once it has one.
- **The mix readout has to be about the same things it counts.** "8 sources ·
  2 heard · 2 too far" is a line that does not add up, because five of those
  eight are bells and speakers and clocks that are silent until something
  rings them. Machines are counted with the machines and the kit is listed
  beside them.
- **`emissive` had a sibling.** Phase 3 found that a glowing lens needs its
  own material; Phase 4 found that a *bell* needs its own scheduling. A gong
  is three strikes 0.42 s apart, and the first two have to be cut short by
  the next hammer or the partials pile into mud — a repeater rings shorter
  than a single strike does, which is not obvious until you hear it wrong.
- **Nothing may exist before a gesture.** An AudioContext created on page
  load is a suspended context, a console warning and a tab the browser marks
  as making noise. It is built on the click that enters the walkthrough,
  which is the first gesture that means "I want to be in the building".
- **The editor stays silent, on purpose.** A floor-plan tool that hums at you
  is a bad neighbour. Leaving the walkthrough stops every voice rather than
  muting them, because an editor that is quiet because its gain is zero is
  still an editor running a mixer in the background.

### Deliberately left for later

- **Transmission loss is one number per situation, not a ray cast.** A wall
  costs 17 dB and a lowpass at 900 Hz, a slab 24 dB at 500, the building
  envelope 20 at 700 — regardless of how many walls are actually between you
  and the source. The model could count them, but the real path through a
  school is under a door and down a corridor, and a careful cast would give a
  more precise answer to the wrong question. Two rooms deep sounds like one
  room deep.
- **No occlusion for sound and no early reflections.** The impulse response
  is a decaying noise burst with a pre-delay and a damped tail; it has no
  discrete first reflections in it, which is what a room's *shape* (as
  opposed to its volume) actually sounds like.
- **The bell has no schedule.** It rings when you press `B` or click the
  button. Periods, passing periods and a clock that drives both Phase 3's sun
  and this are Phase 6's, and deliberately left there.
- **The PA says nothing.** The announcement is band-limited noise with a
  syllable envelope — convincingly somebody talking down a corridor, and
  nothing you can make out. Real speech would mean an audio file, which is
  the one thing this phase is built around not having.
- **Footsteps are your own only.** Nobody else is in the building yet; when
  Phase 6 puts them there, `footstepFor` and the budget already take a
  position rather than assuming the listener's.
- **A room's own noise floor isn't modelled.** HVAC is placeable and the
  ambient bed is a constant; there is no background level per room, which is
  the other half of what an acoustics report would want beside RT60.
- **`roomsOnFloor` has one caller.** It exists at full strength — every
  distinct room on a storey with its complete acoustics — and the editor
  panel prints three lines of it. It is Phase 7's reader, wired to something
  now so it can't rot.

## Phase 5 — The site ✅

The building stops floating. **Done** — save v7 (three optional fields, none
of them written unless used), three new pure modules (`js/terrain.js`,
`js/site.js`, `js/roof.js`), one new tool (`js/siteedit.js`), a second
blueprint sheet, 23 new catalog rows in a new Landscape category, and 465
tests.

- [x] Terrain: a heightfield under and around the slab — `supportAt()`'s
  "the site" answer becomes a lookup instead of a constant 0.
- [x] Hardscape: parking lots, bus loop, walkways, ball-court markings —
  flat colored/striped regions, plausibly polygon rooms with a `site` flag
  rather than a new geometry system.
- [x] Sports fields with line markings, plus the Phase 1 outdoor props
  (playground, benches, racks) getting somewhere real to stand.
- [x] Landscaping: trees/hedges as instanced props (they're just catalog
  rows with `site` mount semantics).
- [x] Roofs and facade styles: parapet vs pitched, brick/panel/stucco
  facade materials — the exterior stops being extruded wall tops.

*Collides with:* the flat-site assumption in `collide.js`, the
footprint-bounded grid (polygon site regions already escape it, the way the
Learning Commons does), and the blueprint (a site plan page is a natural
addition).

### How it actually landed

- **This is the first phase that took an assumption back rather than adding
  to one, and it cost exactly one line.** `supportAt()` ended with
  `consider(GROUND_Y, 'ground', -1)` — a constant zero, the site, everywhere,
  since Phase 5 of the first arc. It now reads `consider(groundAt(opts.site,
  x, z), ...)` and *every* other outdoor behaviour fell out of it without a
  second line of physics: a bank too steep to step up refuses you, a jump
  lands on a slope, walking down a berm doesn't trigger the edge refusal.
  The one thing that did need saying is that `storeyAt` measures from datum —
  walk up a fifteen-foot mound and your feet are at fifteen feet, which used
  to mean "second storey" and handed you the wrong collider, so the trees on
  the hill stopped being solid. One extra argument, a no-op indoors because
  the pad holds the ground at datum there.
- **The building's pad is derived, and that is the decision the terrain hangs
  on.** A slab is at y = 0 by definition, so ground running under the building
  has to be too, or the school floats or is buried. The obvious fix is to
  forbid grading there — a rule you would then have to re-enforce every time
  somebody laid a floor tile. Instead the pad is a *field*: `terrainField()`
  sweeps a distance transform out from the footprint and `groundAt` eases the
  graded height to zero across it. Move a wall and the pad moves with it, for
  free. Seventh time this codebase has taken that trade, after wall thickness,
  stair cuts, guardrails, blueprint symbols, the sun's direction and RT60.
- **The pad has to be interpolated as a *distance*, not as a weight.** The
  first version pre-multiplied the pad into the height lattice per post, and a
  forty-foot schoolhouse on a twenty-foot lattice bled a few inches of
  hillside under its own slab — the apron was narrower than the spacing of the
  posts that would have to record it. Interpolating the distance and applying
  the falloff at sample time is one extra lerp and makes the apron exact at
  any building size. The distance itself is swept on a four-foot lattice, not
  a twenty-foot one, for the same reason.
- **The wishlist's own guess was half right, and the wrong half was the
  interesting one.** Site regions *are* polygon rings read with shapes.js's
  helpers — a second ring implementation would have been a second set of
  winding bugs. But they are emphatically not rooms with a flag. A site region
  has no walls, no ceiling, no openings, no paint, no finish, no flood fill,
  no acoustics and no storey; putting one in `floor.shapes[]` would have meant
  the blueprint, the collider, walls.js, finish.js, acoustics.js and polyedit
  each growing an `if (!s.site)` they could never drop again. The retrospective
  calls two room representations "a standing tax"; a third one wearing a
  room's clothes would have been worse. `state.site.regions[]`, and not one
  room reader was touched.
- **You do not draw a free-throw line.** You say "this asphalt is a basketball
  court" and the court paints itself at 84 by 50 feet with a 19.75ft
  three-point arc and a 12ft key, fitted into the region's own *minimum-area*
  rectangle — so a court drawn at 30° to the grid comes out square to itself,
  and a court drawn on a region too small for one shrinks rather than
  overflowing. The same machinery stripes a car park at 9 by 18 with a 24ft
  aisle, ladders a crosswalk, dashes a bus loop's centre line and lays out a
  400m track. Nine markings, every one of them arithmetic over a rectangle,
  every one of them with a test that checks it against the rule book rather
  than against a golden image.
- **Rotating calipers, of all things, earned its keep.** The minimum-area
  rectangle of a hand-drawn region is what makes an angled court square; the
  axis-aligned bounding box of a square turned 45° is half again as big as the
  square. Twenty lines, exact rather than a search (one of the hull's own
  edges is always a side of the answer), and it is the single function the
  whole markings half rests on.
- **A pitched roof over an arbitrary polygon is a straight skeleton, and a
  rectangle's is arithmetic.** So the footprint is rasterized onto the cell
  lattice, decomposed into a few large rectangles by the maximal-rectangle
  sweep, and each gets an exactly correct hip or gable — which is also how an
  L-shaped school is actually built, two rectangular masses meeting at a
  valley. Eaves hang only on the sides where the building really stops, which
  is a question the mask already answers. The parapet comes off the same
  mask's boundary loops, and it is the default: a school that stops dead at
  its wall tops is the unusual one, so an old file gains a cap the way a v5
  file gained door leaves.
- **The facade is two vertex colours, not two meshes.** An exterior wall is
  one box with a painted classroom on one side and weather on the other, so it
  cannot have two materials — but BoxGeometry lays its faces out in a fixed
  order, `addOriented` builds every wall along +X and turns it, and that sends
  local +Z to the run's left-hand normal, which is the same normal walls.js
  probes with `side: +1`. "Which face is outside" was already a question the
  model answered. Painting that face brick and leaving the other off-white
  costs one colour write per wall. The parapet band and the gable ends, which
  are exterior on both sides, get the real brick *texture*, and they are the
  surfaces that carry the material anyway.
- **Phase 4's footsteps went outside for one argument.** `footstepFor(kind,
  finish)` gained a third parameter and site.js's surface table gained a
  `step` column, and now walking off the terrazzo onto gravel sounds like
  walking onto gravel. Three voices rather than ten, because the ear does not
  distinguish a concrete walk from an asphalt drive and very much does
  distinguish either from grass.
- **The site plan is Phase 7 arriving early again**, the way the acoustics
  roll-up did. Contours come out of the same marching-squares pass over the
  same field the walker stands on, so a spot height on the drawing is a spot
  height underfoot by construction; the surface schedule is the same
  arithmetic a bill of materials wants; and the building appears as a hatched
  outline off the roof mask, because a site plan cares where the building
  meets the earth and not how it is partitioned inside.

### What fought back

- **Coplanar is the one thing a depth buffer cannot resolve.** A lawn drawn
  first with a car park on top of it is how anybody would draw a site, and it
  leaves two surfaces at exactly the same height — the first render came out
  mottled green over every paved region. Regions now stack a fraction of a
  foot apart in draw order, capped so a design with two hundred of them
  doesn't end up on a plinth.
- **...and the near-coplanar case fought back separately.** Even once the
  surfaces were above the terrain, they still poked through it in patches,
  because the ground *mesh* is two triangles per post cell and the ground
  *field* is bilinear between posts. The gap between the two is the cell's
  twist, a few tenths of a foot on a graded site. Halving the mesh spacing
  quarters that, and paving now stands four inches proud of the earth — which
  is, not by coincidence, what a course of asphalt on its base actually is.
- **A lawn drawn over the whole site is a lawn on the corridor floor.** Site
  surfaces are polygons draped on ground that isn't flat, so they are
  triangulated and subdivided until no edge is long — and a coarse triangle
  straddling the building line pushes a wedge of grass an inch above the
  terrazzo. Triangles that straddle the footprint now keep splitting down to
  two feet, and the ones over a slab are dropped. The test is `floorSolidAt`,
  the same one the walker uses, so the ground you can see is the ground you
  can stand on.
- **The colour was applied twice, and everything looked like midnight.** A
  site material bakes its colour into its texture the way a floor finish does,
  and the vertex colour multiplies over it — so tinting the mesh with the
  surface's own colour squares it, and a lawn comes out the colour of a pine
  forest. Every draped surface, roof face and parapet is white-vertexed now,
  meaning "the material as authored". This is the second time a three.js
  colour pipeline has cost real debugging time in this codebase, after the
  bare `'#rrggbb'` NaN in `coloredGeo`.
- **`mergeGeometries` will not mix indexed with non-indexed.** A coping is a
  BoxGeometry and a roof deck is a raw triangle list, and merging them into
  one mesh throws. `slabGeo` already documented this in Phase 3; it was worth
  rediscovering to learn that the fix is usually a second mesh rather than a
  `mergeVertices`.
- **A site is not a footprint.** `terrainFor` sizes itself to the building
  plus a margin, and the default margin is two hundred feet — a car park. A
  soccer pitch is three hundred and thirty feet long, so the sample school
  asks for four hundred, and the whole site comes to about twenty acres and
  2,300 elevation posts. That is 60kB of the save file, which is the largest
  single thing in it and still nothing next to a texture.
- **Grading under the building silently does nothing**, which is correct and
  reads exactly like a bug. The tool now checks the pad weight on pointer-down
  and says so rather than letting somebody drag at a slab for ten seconds.

### Deliberately left for later

- **A heightfield, and only a heightfield.** No caves, no overhangs, no
  retaining walls, no cut-and-fill volumes. A school site is a graded plane
  with some slope on it; anything that needs two elevations at one point needs
  a different model, and nothing here does.
- **The walker still has no head.** Vertical collision was skipped in the
  first arc and stays skipped: you can walk under a tree canopy, which is
  what you want, and also under a stair run, which is not.
- **A pitched roof over a curve is still a rectangle.** The mask is at
  four-foot resolution and the decomposition is rectilinear, so the Learning
  Commons' curved wall gets a stepped eave. A straight skeleton would fix it
  and is a phase of its own.
- **Regions cannot be edited after they are drawn**, only restyled and
  deleted. The vertex tool does this for rooms already; pointing it at site
  regions is a small piece of work that wants the two selections unified
  rather than duplicated, which is why it isn't here.
- **No site props ride the terrain unless the catalog says `site`.** An
  ordinary chair placed outside the building sits at datum, floating over a
  berm. The rule is deliberately the catalog's rather than a per-prop
  "am I over a slab?" test, which would move the furniture in a classroom the
  moment somebody erased the floor under it.
- **The track marking exists but the sample has nowhere to put one.** A 400m
  oval needs 580 by 300 feet clear, which is bigger than the demo site's whole
  east half. It is tested, it draws, and the first person to draw a big enough
  region gets one.
- **Drainage, kerbs, retaining walls, tree canopies that shade the building.**
  All of them are things a real site plan has and none of them are things a
  floor-plan tool needs before Phase 7 starts asking whether the building is
  any good.

## Phase 6 — A living school ✅

The walker stops being alone. **Done** — save v8 (one optional field: how many
people and which seed, never the people themselves), three new pure modules
(`js/navgraph.js`, `js/schedule.js`, `js/agents.js`), one new panel, a crowd
rendered as instanced rigid-part puppets, a fire drill with a heatmap, and 542
tests.

- [x] Ambient students and teachers: capsule-simple bodies, walking the
  halls, sitting at the Phase 1 desks (which is why seats are separate
  objects), using doors.
- [x] Navigation derived from the model: rooms, doorways and stairs already
  describe a nav graph; `collide.js`'s pure walker becomes a shared body
  resolver for N agents, not just the camera.
- [x] The bell schedule: periods, passing-period crowd surges, a clock that
  drives Phase 3's sun and Phase 4's bell.
- [x] "Day in the life": pick a generated student, follow their timetable
  first-person or over-the-shoulder.
- [x] Fire drill: everyone routes to the nearest exit; slow spots and
  door-width bottlenecks render as a heatmap — the playful face of Phase
  7's egress analysis.

*Collides with:* `collide.js` being camera-only and the collider's
build-once lifecycle; performance wants instanced skinned crowds (or
rigid-part puppets, which instance trivially). *Leans on:* Phase 5's site —
an agent walking out of the building now has walks, a bus loop and a field to
route across, and `groundAt` already tells it what height it is at.

### How it actually landed

- **The walker took an `n` without being asked for one.** The prediction was
  that `collide.js` would have to be rebuilt for a crowd. It didn't: an agent
  *is* the camera with a timetable instead of a keyboard — same radius, same
  `moveWalker`, same `supportAt`, and a stair is climbed by walking at it
  because a stair was always a surface. What collide.js actually gained is
  three things a hundred walkers need and one could do without: a uniform grid
  over segments and props (the v1 retrospective's "known fix", finally worth
  the fifty lines), circle-vs-circle resolution so bodies push each other, and
  `updateDoorsFor` so one shared set of leaves can answer to a crowd rather
  than to whichever caller went last.
- **Rooms as hubs, doorways as two-sided portals.** The graph is the classic
  portal graph with two additions, and walking it forced both. A room
  contributes a hub node, so an L-shaped corridor routes round its own corner.
  And a doorway contributes *two* waypoints, one either side, three feet out —
  because a route that merely aims at a doorway leaves a body sliding along
  the wall beside it forever. Threading a door is the single most load-bearing
  detail in the phase.
- **Everything is derived, again.** There is no `state.nav`, no saved agent,
  no baked route. The graph is a reader over the model the way `blueprint.js`
  and `acoustics.js` are; a population is a pure function of (design, seed,
  size); an edit throws the graph away and the next frame builds another. What
  the file carries is three numbers.
- **The clock runs fast; the people never do.** `life.rate` is *simulated
  minutes per real second* — a corridor at ten times speed is a blur nobody
  can read, and the thing worth watching is a passing period at the pace a
  passing period actually happens. So the bell schedule sprints and the crowd
  walks, which is the pair of speeds a school day genuinely has.
- **One collider per storey for the whole building.** This is the build-once
  lifecycle the wishlist warned about, and the collision it caused was not the
  one expected. Editing while people walk was easy — throw the cache away on
  change. What bit was *two* caches: the walkthrough built its own colliders
  and so did the crowd, which meant two sets of door leaves carrying the same
  keys, and agents walking into doors the camera had already opened. One
  cache, handed to the walkthrough by whoever owns the crowd.
- **A fire drill is the feature that finds bugs in the building.** Two of the
  sample school's own props turned out to be somewhere nothing had ever
  noticed: a vending machine parked across the stair hall's doorway, and two
  ornamental trees standing fourteen feet inside Room 101. Nobody had walked
  there. Three students spent an entire drill walking into a tree.
- **The bell already existed and so did the sun.** Phase 3 put the sun on a
  clock and Phase 4 put a bell in the catalog; this phase only had to cross a
  minute and ring what was already there. The three were built in the right
  order by accident, and the seam between them is one call.

### What fought back

- **Crowd deadlock has more than one cause, and each fix reveals the next.**
  In order, all of them real: a fully-separating body push means two people
  wanting the same three feet of doorway shove each other apart forever (so
  bodies push at half strength); braking for anybody in front means two people
  walking at each other both stop and neither moves again (so you only follow
  somebody going *your* way, and go round somebody coming the other way);
  taking turns at a doorway chains into a polite, stationary building (so a
  body that is itself waiting is not somebody to wait for, and nobody waits
  more than two and a half seconds); and a three-foot doorway with a person
  standing in it is a shut door, because an idle agent was an immovable
  object. There is no single rule that produces a crowd. There are six, and
  the last one is an escape valve that ignores the other five.
- **The plug in the doorway.** The bug that cost the most: a body shoved
  *into* a doorway by the queue behind it still wanted to reach the waypoint
  three feet in front of it — which was now behind it — so it turned round,
  walked back into the crowd, and corked the door for the rest of the drill.
  Every evacuation stalled at about 40%. Standing in a doorway now counts as
  having reached the near side of it.
- **Re-planning is worse than being stuck.** An agent that asks the graph for
  a new route whenever anything blocks it will pace a corridor forever: the
  room it is standing in flips as it drifts across a threshold, and each room
  answers with a route the other way. Skipping the blocked waypoint and
  keeping the route is right; re-planning is the last resort, and rate-limited
  even then.
- **A queue walking past a classroom held its door open** — proximity was
  intent when there was one walker and is not when there are ninety — **and
  the open leaf was then the thing the queue couldn't get past.** A body now
  tells a leaf whether it is *using* that door. It is still something the leaf
  won't swing into either way.
- **A stair's landing is inside the hole it cuts.** The obvious node for the
  top of a run is the middle of its landing; `openingRails` fences every side
  of that hole except the one you walk out of, so everybody routed there
  queued at a handrail. It took a drill that never finished to see it. The
  node sits past the far edge of the cut now, and `runLandings` is exported so
  agents.js can find the same two points when somebody re-plans halfway up.
- **Door leaf keys did not carry their storey.** Harmless while only the
  camera's floor could have a door moving on it; a school with people in it
  has two, and level 2's doors were posing level 1's meshes.
- **A slow machine runs the simulation in slow motion, on purpose.** `dt` is
  capped, so a frame that takes a second advances the school by fifty
  milliseconds. The alternative is a crowd that teleports through walls on
  every hitch, which is not a trade a design tool should make.

### Deliberately left for later

- **The last fifth of an evacuation is a tail.** Most of the school is out in
  a plausible time; a handful spend a long while working their way out of a
  corner a crowd shuffled them into. The cause is known and is the next item.
- **There is no nav mesh inside a room.** The graph routes between rooms;
  crossing one is a straight line at the hub, and furniture in the way is
  handled by sidestepping rather than by pathing. It is why a class walks
  round a desk row rather than down the aisle between them, and why a chair
  boxed in between a desk and a wall never gets sat on. A coarse grid over
  each room's floor, walked with the same A*, is the fix and is a phase's
  worth of work on its own.
- **Nobody has a head, still.** Agents are circles like the camera, so a crowd
  on a stair is resolved in plan only. Two people on the same run at different
  heights do not collide, which nobody has yet noticed.
- **Lifts are a teleport with doors**, for agents exactly as for the camera. A
  queue for a lift is a real thing in a real school and would need a car with
  a position, a call button and a state machine — none of which a floor plan
  is asking for yet.
- **The timetable is random, not scheduled.** Every student gets a room per
  period that isn't the one they were just in; nothing balances class sizes,
  matches subjects to rooms, or keeps a cohort together. Phase 8's generator
  is where a real timetable belongs, because it is the same problem as laying
  out the building.
- **The crowd is not in the blueprint and not in the acoustics.** A plan sheet
  that showed occupancy, and a room that got louder with thirty people in it,
  are both one reader away — and both belong to Phase 7, where a number on a
  drawing has to mean something.
- **Nobody carries anything, opens a locker, or talks.** The catalog has
  lockers and the PA works; a school where people use them is a different
  project, and a delightful one.

## Phase 7 — Analysis & rigor ✅

The tool starts answering "is this a *good* school building?" **Done** — five
new pure modules (`js/occupancy.js`, `js/egress.js`, `js/daylight.js`,
`js/takeoff.js`, `js/report.js`), one new panel, one new option on `buildNav`,
occupant loads on the plan sheet, a CSV of every number the tool knows, 87 new
tests — and no save-format change at all, because none of this is stored.

- [x] Egress checks: travel distance to the nearest exit from any point,
  door widths against occupancy, dead-end corridor detection — all
  computable from the same model the blueprint reads, and now continuing past
  the door onto Phase 5's walks (a discharge route is a site question).
- [x] ADA/accessible routes: can a wheelchair (no stairs, ramp/elevator
  links only, door widths) reach every room? Phase 2's ramps and elevators
  make the answer sometimes-yes.
- [x] Capacity: per-room occupancy from area and room label; a roll-up per
  floor and building.
- [x] Cost / bill of materials: walls by the foot, glass by the bay, props
  by the row, paving by the square foot — a spreadsheet-ish export beside the
  blueprint. `finishSchedule` and `siteSchedule` already do the arithmetic;
  this is the reader that prints it.
- [x] Daylight and acoustics first passes: window area per room area,
  reverb estimates from volume — honest approximations, labeled as such.

*Leans on:* `computeFloorPlan`'s model-not-pixels approach — every analysis
is another pure reader over the same state, and belongs in a headless
module with tests, per the house rule.

### How it actually landed

- **The phase was mostly reading.** The build order's claim — that every check
  already had its data — held almost exactly. `egressField` was written in
  Phase 6 with a comment saying Phase 7 would want it; `roomsOnFloor` was
  written in Phase 4 with a comment saying the same; `finishSchedule` and
  `siteSchedule` both say it in as many words. Four of the five modules are a
  loop over something that existed, and the fifth is the one option nobody had
  written yet. A phase that spends its time on presentation rather than on
  plumbing is what a well-stocked larder buys.
- **Cost is not distance, and a code limit is written in feet.** The graph
  charges a stair at 1.7× its length plus eight feet a storey, which is the
  right way to *choose* a route and the wrong number to compare with a 250ft
  travel limit. Every edge now carries both — `cost` to route on, `dist` to
  report — and `egressField` takes `{ metric: true }`. Room 201 in the sample
  school went from an alarming 312 "cost feet" to a true 260, which is still
  ten feet over the limit and now for a reason somebody can pace out.
- **The accessible route really was one option.** `buildNav(state, {
  accessible: true })` skips stair links and doorways under three feet, and
  everything downstream — reachability, which rooms are stranded, whether the
  upper storey is on a route at all — is the same reader run against a smaller
  graph. Take the sample school's lift out and Level 2 turns stairs-only in a
  single line of output.
- **A finding is a sentence, not a boolean.** Every check reports which rule it
  applied, what it measured and what the limit was: *"437 occupants need 87 in
  of clear exit width; the doors provide 76 in, which carries 380."* That was
  a presentation decision at first and turned into a design constraint — a
  check that can't say why it fired doesn't get written, which is why there is
  no scoring, no grade and no single number for how good the building is.
- **The sample school fails its own report, and every failure is real.** Two
  doors for 437 people, a classroom 260ft from the nearest one, 48 inches of
  stair for a storey that needs 65, and thirteen rooms over the ANSI
  reverberation limit. Phase 6 already knew: the fire drill's stragglers and
  the travel-distance table are the same finding twice, one of them walked and
  one of them measured.
- **The takeoff prices the plan's own geometry.** `floorTakeoff` calls
  `computeFloorPlan` rather than re-walking the walls, so the wall the drawing
  prints is the wall the schedule prices, by construction — the same bargain
  `solidSpans` struck between the collider and the plan two arcs ago. It cost
  one small addition: an opening now carries its height, so glass can be
  bought by the square foot.
- **The classification is a guess made out loud.** A room's occupant load
  comes from the name somebody typed, so the table is ordered specific-first,
  every row reports the factor it used, and a room nobody named is counted at
  100 ft² a head and *listed* as unnamed rather than folded silently into the
  total. The alternative — defaulting an unnamed room to "classroom" — fills a
  building with occupants nobody put there.

### What fought back

- **Counting the corridors doubles the school.** A hall's occupants are the
  classrooms' occupants walking through it, and an occupant load that adds
  both is wrong by a factor approaching two in a building that is mostly
  corridor. Circulation and restrooms carry a factor of zero, which is the
  single most load-bearing line in the use table and the one that looks most
  like an oversight.
- **"Storeroom" contains "room" and "Learning Commons" contains "commons".**
  Name matching is a table walked in order, and the order is the design:
  storage above classroom, library above assembly, and a classroom matching a
  room *number* rather than the bare word. Three real school room names broke
  three different orderings before it settled.
- **Door width almost never fails, and door count almost always does.** At
  0.2in per occupant, 32 inches of clear door carries 160 people — so a
  classroom of eighty with one 3ft door is comfortably legal on width and
  plainly illegal on count. The first version of the test assumed one rule and
  asserted the other; two separate findings now say so separately.
- **A portal graph has no idea what a dead end is.** The definition that
  worked is *onward portals*: the neighbours through which the exit is closer
  than it is from here. Two of them is a corridor with a choice at each end;
  exactly one is a pocket, and its depth is the farthest point in it measured
  from that one way out. It finds the sample school's upper hall at 97 feet,
  which is exactly right and took three wrong definitions to reach.
- **One room, two names.** `acoustics.js` calls a room `s7` or `g0:184` and
  predates the graph; `navgraph.js` calls the same room `r0:s7` or `r0:g184`.
  The parts are identical — a shape's id, or a region's lowest cell — so the
  join is a string rewrite, but it is a string rewrite in the middle of a
  report, and the comment explaining it is longer than the code.
- **Grid rooms have no identity, still.** Measuring how far it is across a
  lattice room means rebuilding the room's own cell list out of `cellRoom`,
  because `floorRooms` returns a count and not the cells. The v1
  retrospective's standing tax, collected again, in a phase that never touches
  the editor.
- **A report is the most derived thing in the codebase.** A graph, a load per
  room, a multi-source Dijkstra, a reverberation estimate per room and a
  takeoff over every wall — about sixty milliseconds on the sample school, and
  wrong the instant a wall moves. Rebuilding on every frame of a drag is
  absurd; leaving a stale number on screen is worse than showing nothing. An
  edit marks it stale, the badge says so, and the rebuild lands half a second
  after the drawing hand stops.

### Deliberately left for later

- **The discharge route stops at the door.** `navgraph.js` flattens the whole
  outdoors into one node, so a route out ends at the exit and a muster point
  45ft beyond it — which is fine for a drill and not the *exit discharge* a
  code means, where the walk from the door to the public way is measured over
  Phase 5's walks. The site has regions and a heightfield; nothing yet routes
  across them.
- **No prices, on purpose.** The takeoff counts what is drawn and stops there.
  Unit costs are local, dated and trade-by-trade, and a tool that guessed at
  them would be wrong in a way that looks authoritative. Quantities are the
  honest half, and they are the half a spreadsheet wants.
- **Daylight is a glazing ratio, not a daylight factor.** Nothing here knows
  about orientation, overhangs, the roof, or room depth from the window —
  Phase 3's sky model could answer the first three, and the answer would still
  be a simulation rather than a reading. The 2.5×-head-height depth rule is
  the obvious next honest approximation.
- **Common path of egress travel is a constant that nothing measures.** The
  number is in the limits table and no check uses it: measuring where two
  directions of travel become available needs distances *inside* a room, which
  is the nav mesh Phase 6 also wanted and did not build.
- **The crowd doesn't know the occupant load.** `life.students` is still a
  slider; the report now knows the building holds 437, and populating it with
  exactly that many is one line and a nice idea. Nothing yet cross-checks the
  fire drill's stragglers against the travel-distance table either, though
  they are the same building failing the same way.
- **Accessibility stops at routes.** Doorway clear width and stairs, yes;
  turning circles at fixtures, reach ranges, counter heights, the 60in circle
  a restroom needs — no. The catalog has the props and the model has no notion
  of clearance around one.
- **The report doesn't print.** The CSV is the export, and a title-block code
  panel on the blueprint — occupant load, exits, travel distance, per storey —
  is the natural other half of the occupancy tags this phase put on the plan.
- **Sprinklered is a checkbox, not a property of the design.** It changes the
  limits and is not saved, because nothing else about the analysis is saved
  either. The first thing that genuinely belongs *in* the file — a code
  edition, an occupancy group, a design occupant load somebody typed — is what
  would open save v9.

## Phase 8 — Generation, tracing & the structural shadow ✅

The name of the tool, finally cashed in — and renamed, because the half of
this phase called "AI" turned out not to need any. **Done** — six new pure
modules (`js/program.js`, `js/brief.js`, `js/generate.js`, `js/autofurnish.js`,
`js/overlay.js`, `js/shadow.js`), one new tool (`js/overlayedit.js`), a
generate sheet, a measurement dialog, save v9, one new report section, 133 new
tests, and two long-standing bugs found on the way.

- [x] Parametric school generator: seed + student count + grade band →
  corridors, classroom wings, gym/cafeteria/library/office blocks, stairs
  where they're needed, every room furnished from its label's template, and a
  car park sized to the staff count. It is a spine with wings — the finger
  plan every district built between 1955 and now — and `layoutSchool` is pure
  geometry so the plan can be checked without building it.
- [x] Auto-furnish one room from its label ("make this a science lab") — the
  generator's smallest useful piece, shipped first and then called by the
  generator, which is what proves it was the right piece.
- [x] ~~Prompt-to-floorplan: natural language → parameters~~ — **a phrase
  table, not a model.** There is no LLM here and the box says so. It reads
  student counts, grade bands, storey counts, a seed and four flags, and it
  prints every word it ignored. See "what fought back" for why that turned out
  to be the more useful thing anyway.
- [x] Generate-then-edit is sacred: output is ordinary state. There is no
  `state.generated`, no marker and no provenance field — the moment a design
  carries one, some tool starts reading it.
- [x] **A tracing overlay** (not on the original list): a PNG, JPEG or WebP
  under the plan, scaled by measuring something on it and saying how long that
  thing is. One division, no fitting, no guessing.
- [x] **The structural shadow** (also new): an upper storey is limited to the
  footprint of the storey below it, the footprint is drawn under the plan
  while you edit, and overhangs are switched *on* rather than switched off.

*Leans on:* room labels, templates, and the additive save format;
*collides with:* nothing structurally, which is exactly why the phases before
it mattered.

### How it actually landed

- **The program is not the plan, and separating them was the whole trick.**
  `program.js` turns six hundred students into twenty-nine teaching stations,
  a cafeteria that seats a third of the school, and sixty-six parking spaces,
  with the rule that produced each row printed beside it. It draws nothing.
  `generate.js` takes that schedule and decides where things go. The split
  means the numbers are checkable without a building — the generate sheet
  prints the schedule *before* you press the button — and the layout can be
  tested against numbers it didn't invent.
- **One scheme, chosen, not searched.** A spine along the top with the gym,
  cafeteria, kitchen and library north of it; wings hanging south at a seeded
  pitch, each a double-loaded corridor with a stair tower at both ends; light
  courts between the wings with the admin suite lining them. There is no
  optimizer and no scoring. The layout is a decision, and Phase 7's report is
  what says whether the decision was any good — which is the loop the build
  order promised: seed a plan, run the report, move a door, run it again.
- **The generator sizes its own stairs from its own occupant load.** The one
  dimension in the whole scheme that comes from the program rather than from
  the proportions: IBC gives 0.3in of stair per person upstairs, the layout
  can price its own rooms because an occupant load is a name and an area and
  it has just written both, and an eight-foot stair falls out. Phase 7's
  promise — "occupant load is one call away" — cashed in exactly as advertised.
- **Every storey but the top is built out solid, and that is what makes the
  shadow rule true by construction.** The wings are identical on every level;
  what differs is how many rooms got dealt into them. Filling the remainder of
  each lower bay with a storeroom or a flex room means an upper storey is
  inside the one below it because it is drawn from the same rectangles, not
  because anything checked. A hundred and ninety-two briefs across four bands
  and four storey counts produce zero unsupported cells.
- **Exits are cut twice: once by the plan, once by the shell.** The scheme
  puts a door at each end of the spine and at the foot of every wing, which is
  what a scheme drawing shows. What it cannot know until the walls are
  standing is where else the building touches the outside — and a stair tower
  that discharges straight to the grass is worth about a hundred and twenty
  feet of travel distance on an upper floor. Adding that one rule took a
  fourteen-hundred-student three-storey school from twenty-three rooms over
  the travel limit to two.
- **Scaling an image is one division, and refusing to guess is the feature.**
  A picture arrives with no idea how big it is. Click the two ends of a door,
  type three feet, done. The calibration is kept in image pixels so it
  survives a move, a rotation and a save, and the panel prints what the
  picture turned out to be — "that scan is 344ft across" — which is the sanity
  check somebody actually reads.
- **The brief parser's best feature is the list of words it ignored.** Typing
  "a warm, community-facing campus that feels like home" returns *nothing
  recognised* and six ignored words, and the controls don't move. A parser
  that quietly did its best with that sentence would produce a building nobody
  asked for and no way to tell that had happened.

### What fought back

- **There is no model here, and the phase is better for it.** The original
  item wanted natural language feeding the generator. Without an LLM the
  honest version is a table of phrases — and writing it made the actual
  question obvious: the sentence was never the input. The five controls are
  the input; the sentence is a *shortcut for filling them in*, and it has to
  show its work or it is worse than no shortcut. The box is labelled as a
  phrase table in the dialog itself, because a tool that lets you think it is
  cleverer than it is will be trusted exactly once.
- **A portal graph flattens a room to one hub, and a corridor is a room.** Left
  whole, a four-hundred-foot spine routes every trip in the building through
  its own midpoint, and the travel-distance table reports walks nobody takes.
  Cross-corridor doors every 120ft fix it — they are real, they are what a
  smoke compartment is, and they cut the reported distances by a third. What
  they do not fix is the residual: a three-storey generated school still reads
  ten or twenty feet worse than it walks, because every corridor is still one
  node. The honest fix is a nav mesh, which Phase 6 wanted and did not build.
- **Splitting a corridor helps and hurts at the same time.** Shorter segments
  put each hub nearer the rooms it serves; more segments mean more hub-to-hub
  hops, and each hop double-counts. Twelve-cell compartments measured *worse*
  than thirty-cell ones. The number in `CORRIDOR_SEG` is the outcome of a grid
  search over the sample briefs, not a principle.
- **A wide room's door has to go in the middle.** The first version put two
  doors at 28% and 72% of any side longer than twelve cells, on the theory
  that a big room empties through two. A stair hall is nineteen cells wide and
  the corridor it opens onto is three, so both doors opened into the
  classrooms either side and fourteen upper-floor rooms became unreachable.
  Two doors is now a rule about assembly rooms, and everything else gets one
  door in the middle of the side, which is the only position guaranteed to
  actually be on the corridor.
- **The seed did nothing for an afternoon.** The layout was deterministic in
  the program's numbers, so `seed: 7` and `seed: 8` produced the same building
  down to the room numbers — a knob that lies. It now shuffles which
  interchangeable classroom lands on which storey, jitters the light courts,
  picks the wing with the lift, and chooses the facade, the roof and the
  compass bearing. Two of four seeds pass the travel check on the same brief,
  which is the point: the seed is a choice with consequences, or it shouldn't
  be there.
- **`Object.assign` only ever adds.** Undo restores a snapshot by assigning it
  over the live state, so undoing across the moment something was *first*
  written left the record behind — the first site region, the first grading
  stroke, and now the first tracing image, which is what made it visible.
  Every optional record on the state had this bug since Phase 5 and nobody had
  drawn the right undo to notice.
- **A plane rotated flat is scaled in Z, not in Y.** `geo.rotateX(-π/2)` bakes
  the rotation into the vertices, so the plane's two extents become local X and
  local *Z* and local Y is zero everywhere. Every flat ghost preview in the
  editor — furniture, stairs, room layouts — has been scaled `(w, d, 1)` and
  drawn one foot deep since Phase 3 of the first arc. Four call sites, one
  line each, and the layout tool's footprint ghost is a rectangle for the
  first time.
- **The image is the first thing in the file measured in megabytes.** Every
  save bump before this one added tens of bytes. A data URL is hundreds of
  kilobytes at best, which is fine in a file and not fine in localStorage on
  every keystroke. Imports are resampled to 2048px and re-encoded as WebP, the
  autosave retries without the overlay when storage refuses it and says so,
  and `serialize` takes `{ omitOverlay }` for exactly that caller. Keeping the
  image outside the design would have kept saves small and made a design you
  email somebody arrive without the drawing they traced — the wrong half to
  lose.
- **Twelve tools don't fit down the side of a laptop screen.** The toolbar has
  been one column since v1 and the comment about it reaching the floor panel
  has been there since Phase 6. Two more tools finally collected: the buttons
  lost a few pixels each and the overhang switch moved to the layers panel,
  beside the shadow layer it governs.

### Deliberately left for later

- **One scheme.** A spine with wings is a school; it is not the only school.
  A courtyard plan, a compact two-storey block, a campus of separate
  buildings — each is a different `layoutSchool`, and the rect-list contract
  between the layout and the builder is deliberately narrow enough that a
  second one is a second function rather than a rewrite.
- **The generator can't read a room adjacency wish.** "Put the art room next
  to the kiln" is the obvious next thing the brief box should understand and
  the layout has nowhere to put it: rooms are dealt round-robin into wing
  slots and the dealing has no notion of who wants to be near whom.
- **Polygon rooms are refused wholesale or allowed wholesale.** The lattice
  can decline one cell at a time as you paint; a polygon arrives all at once,
  so a room drawn entirely off the storey below is refused and one that
  overhangs in part is placed and reported. Clipping a ring to a footprint
  mask is a different tool, and a room silently trimmed to a staircase of 4ft
  steps is not what anybody drew.
- **The shadow is measured at 4ft.** A wing that oversails by three feet
  doesn't register and a room whose corner clips a cell centre registers as a
  whole cell. The alternative is polygon clipping between two floors' worth of
  rings on every pointer move.
- **The overlay doesn't print.** It is an edit-mode underlay only: the
  blueprint export draws the model, not the tracing paper, which is almost
  certainly right and is worth saying out loud since somebody will want the
  scan on the sheet.
- **Nothing traces the overlay for you.** Edge detection over the image to
  propose walls is the obvious pie-in-the-sky follow-on and would need a real
  image-processing pass; measuring by hand and drawing on top is the honest
  version and takes about a minute.
- **A generated school is furnished before it is checked.** `furnishAll` runs
  over every named room and stops at the prop cap; a four-thousand-student
  high school lands eight thousand pieces of furniture and nothing asks
  whether the cap was hit in the middle of a classroom. The budget is
  reported, not respected room by room.
- **A four-storey school still fails its travel check.** The scheme's wings
  get long and the hub problem compounds with every storey. It is a real
  finding about a real limitation of a spine plan at that size, and it is also
  partly the graph — telling the two apart needs the nav mesh.

## Phase 9 — Sharing & beyond the tab ✅

Each item here priced the no-build-step, no-deps stance explicitly, and the
bill came to zero: **done** — six new pure modules (`js/gltf.js`,
`js/models.js`, `js/share.js`, `js/tour.js`, `js/minimap.js`, `js/xr.js`,
1,848 lines between them), one new seam in `catalog.js`, save v10, three new
dialogs and two new walkthrough panels, 153 new tests, and not one new
dependency or vendored addon. The one item not built is the one that needs a
server, and it says so.

- [x] glTF prop import — but **not** by vendoring `GLTFLoader`. `js/gltf.js`
  reads `.glb` and `.gltf` by hand in 664 lines with a scope stated out loud,
  against six thousand lines of somebody else's code that is mostly about
  parts of the format this tool will never meet. `assets/models/` finally
  earns its keep; a catalog row points at a file instead of at a `geo` key.
- [x] Whole-building glTF export — the same module, writing. The school
  leaves as one `.glb` in metres with the colours baked into the vertices; a
  generated two-storey school is 56,552 triangles and about four megabytes.
- [x] Link-encoded sharing: the design deflated into the URL fragment with
  `CompressionStream` — platform, not a dependency. The sample school is 5.8
  KB of link. Cloud saves are still the grown-up version and still the first
  item that needs a server.
- [ ] ~~Real-time collaboration~~ — **not built, and the only item here that
  cannot be.** It needs a sync layer, which needs a server. See "deliberately
  left for later" for what the rest of it would need on this side of the wire.
- [x] WebXR walkthrough — `renderer.xr` is core three.js, and the real-scale
  discipline of Phase 1 is exactly what makes it land: `local-floor` puts the
  model's floor under real feet, so a 6ft person is 6ft tall in the building
  with nothing to calibrate.
- [x] Guided tours: stops recorded where you stand, a Catmull-Rom curve
  through them, and video out through `MediaRecorder` — no new deps.
- [x] Minimap while walking, from the blueprint renderer at thumbnail size —
  which turned out to be literally true: `blueprint.js` gained one exported
  function and lost nothing.

*Leans on:* the blueprint renderer, the walkthrough's collider, the additive
save format, and Phase 1's insistence on real dimensions;
*collides with:* the camera, which in a headset is not ours to move.

### How it actually landed

- **Writing a glTF reader was cheaper than vendoring one.** The scope is the
  whole argument: triangles, `POSITION`/`NORMAL`/`COLOR_0`, indexed or not,
  the node hierarchy flattened by multiplying matrices down the tree, base
  colour taken from the material factor and baked per-vertex. No textures, no
  skins, no morph targets, no sparse accessors, no Draco — each refused with a
  sentence rather than half-read. Every one of those exclusions is something
  this build's prop contract could not have used anyway: a prop here is one
  vertex-coloured material, bottom at y=0, sized from its catalog row.
- **The import feature is one seam, and it is in `catalog.js`.** `registerRows`
  lets a design's imported models answer `catalogEntry(type)` alongside the
  built-in table. That single addition is why an imported chair snaps to a
  wall, stops a walker, draws on a floor plan, counts in the bill of materials
  and gets picked by auto-furnish — eight modules, none of which needed a line
  changed, and none of which know that files exist.
- **Fitting is what makes a file behave like a prop.** `fitModel` centres the
  model on its footprint, sits it on y=0 and scales it into the row's w/d/h
  box; `bakeFit` bakes that into the vertices before the geometry is cached.
  An import needs no eyeballing to stand on the floor, and the "how big is
  it?" dialog opens with the size the file itself claims (glTF is metres, this
  is feet, and the division happens once).
- **A link is a design, not a pointer to one.** The payload lives after the
  `#`, which is the one part of a URL a browser never sends anywhere: nothing
  is uploaded, nothing expires, there is nothing to take down. A school
  compresses to under a tenth of its JSON because it is mostly repeated small
  objects. Two thresholds rather than one — comfortable, and a hard refusal —
  because the failure mode is a chat client cutting a link in half, which
  `decodeShare` detects and names rather than throwing at the JSON parser.
- **A tour's legs are timed from their own length.** Record a stop, walk, record
  another: the leg costs its distance at 9 ft/s, so a tour played back runs at
  roughly the pace it was walked, and a stop can hold. The curve is
  Catmull-Rom because it passes *through* every stop — "the camera didn't go
  where I put it" is the one complaint a recorded path must never earn — and
  the ends mirror their neighbour rather than duplicating it, because a
  duplicated endpoint gives the spline a zero tangent and the first leg crawls.
- **The minimap was already written.** `blueprint.js` computes a plan in world
  feet with no canvas in sight and draws one into any 2D context; all that was
  missing was which patch of it a walker can see. `drawPlanBody` — the drawing
  without the title block, legend and north arrow — is the only thing that had
  to be split out, and `drawFloorPlan` now calls it.
- **In a headset the walker keeps its own body.** `walkthrough.js` gained one
  line, `let body = camera.position`, and every line of physics below it reads
  and writes `body`. On a desktop that alias *is* the camera and costs
  nothing; in a session it is a separate vector, because three.js writes the
  camera's transform from the head pose every frame. VR locomotion is then
  four lines: the thumbstick produces the same `fwd`/`right` pair the W and D
  keys do, `updateWalk` resolves it against the same collider, and the doors
  open by the same test.
- **Save v10 keeps the bargain for the sixth time.** A design with no tour and
  no imported model writes neither key, so a v9 file still round-trips as the
  same bytes. What is new is that the autosave now sheds in an order: the
  tracing image first, because a design without its tracing paper is still the
  design, and the imported models only if it must.
- **Undo learned about the second heavy record.** `models` travels beside the
  undo snapshot by reference, exactly as `overlay` has since Phase 8, and for
  exactly the same reason — stringifying megabytes of base64 on every
  pointerdown, a hundred deep, is a hundred megabytes of history for furniture
  nobody is editing. It is safe for the same one reason, too: models.js never
  mutates a record or its array in place.

### What fought back

- **The camera is not yours in XR.** `WebXRManager` decomposes the head pose
  straight into `camera.position` every frame, so anything that owns the
  camera's position — which is to say the entire walkthrough — has to stop
  owning it. The fix (a rig the camera parents to, and a body vector the
  walker keeps) is small; finding out *why* the walker was being teleported
  back to the headset's idea of the origin was not. The related trap: a rig
  must be turned **about the head**, or a snap turn swings the body around the
  room instead of turning it on the spot, and the head's offset has to be
  taken in world axes rather than rig-local ones, or the building lurches
  every time you turn.
- **A floor plan's bounds are drawn around everything on the sheet.** On a
  generated school that includes the trees at the far end of the car park, so
  the minimap's "whole floor" was a thumbnail of a field with a school in the
  middle of it. The map now measures the storey's *structure* with
  `shadow.js`'s `floorBounds` — a function written for the overhang check two
  phases ago — and pads it enough to show the doors in the outside wall.
- **Rastering a plan once and squeezing it does not work.** A plan drawn at
  four pixels to the foot and blitted at a seventh of that has hairline walls
  that fall between pixels and vanish; the map read as an empty cream square
  with some furniture in it. The raster is now keyed by a *bucketed* scale, so
  it is drawn at roughly the size it will be shown at and a wall stays a wall.
- **Two coordinate origins, one drawing.** The cached raster is sized from the
  minimap's own (structural) bounds but drawn by `blueprint.js`, which
  measures from the *plan's* bounds — one translate too many, and the whole
  school slid off the corner of the thumbnail.
- **`CompressionStream`'s writer rejects when the stream errors.** A corrupt
  payload fails at the reader, which is where the error belongs, and *also*
  rejects the un-awaited `write()` and `close()` promises, which surfaces as
  an unhandled rejection racing the readable error. Both are swallowed
  deliberately so a damaged link has exactly one place it is reported.
- **Negative zero.** `moveVector` with a heading of exactly zero produces `-0`
  for one component, and `Object.is(-0, 0)` is false — which a test noticed
  and a caller comparing a delta against zero eventually would have.
- **A button that overflows its dialog is a button the backdrop eats.** Four
  buttons do not fit in a 420px row, so the fourth spilled outside the panel
  and became unclickable while looking perfectly fine. `flex-wrap` and a
  shorter label.

### Deliberately left for later

- **Real-time collaboration**, and it is worth being precise about what is
  still missing on this side of the wire, because the wishlist's own guess was
  right: props and polygon rooms have ids, and **grid cells do not**. A cell is
  an index into a flat array, so "somebody else edited this room" has nothing
  to name. The path is the one Phase 2 of the first arc already built —
  `convertRegion()` promotes a grid room to a polygon room with an id — which
  means collaboration is downstream of a decision to make polygons the only
  representation, not downstream of a sync library.
- **Cloud saves.** Still the first item that needs a server, and now with a
  measured reason to want one: a design with a tracing image or imported
  models cannot travel in a link at all, and that is stated in the share
  dialog rather than discovered.
- **glTF textures, PBR materials, skins, morph targets and Draco.** Every one
  of them is a refusal with a sentence attached in `gltf.js`. Textures are the
  one worth revisiting, and only alongside the PBR upgrade already documented
  in `assets/textures/README.md` — the prop material has no map, so a textured
  import has nowhere to put one today.
- **Teleport locomotion and controller models in XR.** Smooth walking with a
  snap turn is the comfortable minimum and it is what shipped; a teleport arc
  needs a controller ray, a floor hit test and something to draw, and hand
  tracking is asked for in the session's optional features but not used.
- **A tour that does anything but move the camera.** Ringing the bell at a
  stop, scrubbing the hour between two of them, starting the crowd at the
  third — every one of those is a field on a keyframe and a call this build
  already has. The video also has no audio track: `captureStream` takes the
  canvas, and the Web Audio graph would have to be piped into the recorder
  separately.
- **The minimap on touch.** It draws and reads fine, but its four buttons are
  desktop-sized and the panel has not been laid out for a phone.
- **An `EXT_mesh_gpu_instancing` export.** Every prop instance is expanded into
  its own triangles, which is why a furnished school is four megabytes rather
  than a few hundred kilobytes. It is the right trade for now — an extension
  is a thing the importer at the other end may not have — and the wrong one
  the first time somebody exports a school with ten thousand desks in it.

## Phase 10 — Honesty ✅

Four findings the tool had made about itself, unaddressed since Phase 8, shared
one sentence: **the model knows more than it says.** A corridor was one node,
so every travel distance was wrong by ten to twenty feet. There was one layout
scheme, so "generate" meant "generate this shape". The brief read counts but
not relationships. The minimap knew where you were and the report knew what was
wrong, and they had never met.

**Done** — one new pure module (`js/navmesh.js`, 327 lines), a rewritten graph
in `navgraph.js`, two more schemes in `generate.js`, two more tables in
`brief.js`, one overlay on the minimap, 43 new tests, and — as promised — **no
save-format bump**. Nothing here was new capability. It was the capability
already here, telling the truth.

- [x] **A nav mesh, replacing room-as-hub.** Done first and alone, because
  `navgraph.js` has ten consumers and every egress finding and report row moved
  when it landed. Every room's floor is now cut into convex axis-aligned tiles
  and everything standing on one tile is joined to everything else standing on
  it at the straight line between them — which inside a convex empty rectangle
  is the truth. The exported vocabulary is unchanged, which is what kept the
  ten consumers from being rewritten.
- [x] **The findings, drawn on the minimap.** The smallest item and the most
  visible: `minimap.js` turns a report into marks and `main.js` fills the
  rectangles the mesh already cut the rooms into. Second, not last, and the
  claim held — a highlight on the plan is the fastest way to see whether the
  mesh fixed the numbers.
- [x] **More layout schemes.** A **courtyard** (a double-loaded ring round an
  open court) and a **compact block** (one deep rectangle, two corridors,
  three bands of rooms, a cross hall every hundred feet), against the same
  contract as the spine and picked on the generate sheet. The spine is
  untouched; what the two new ones had in common came out into four shared
  functions.
- [x] **Adjacency in the brief.** Two tables in `brief.js` — room words and the
  two relations — and two passes in `generate.js`: blocks reordered in the row
  they are laid in, everything else a greedy swap of two same-sized rooms. Both
  halves report whether they managed it.

*Leaned on:* the portal graph's exported vocabulary, the report's room ids, and
the generate sheet's existing controls;
*collided with:* every number the tool prints — which was the point, and also
why the existing egress and report tests were the acceptance criteria for the
mesh rather than an obstacle to it. They all still pass.

### How it actually landed

- **A room is a set of rectangles, and that is the whole trick.** Greedy
  meshing joins a lattice room's cells back into as few big rectangles as it
  can; a polygon room is sampled onto a 2ft lattice inside its own bounding box
  and meshed the same way, which makes its tiles an *inscribed* approximation —
  a diagonal wall keeps its stair-step and the walk along it comes out a foot
  or so long, which is the right way round for a phase about not flattering
  yourself. Where two tiles of one room meet, a **gate** node sits in the open
  run of the seam, so an L-shaped corridor keeps the corner it has to be walked
  round. On a generated school every room is one rectangle and there are no
  gates at all; the sample school's L-shaped rooms produce twenty.
- **The graph did not grow — its edges moved.** Nodes are still rooms, doorways,
  stairs and the outside, plus the gates. What changed is what a doorway is
  connected *to*: the tile it stands on, and through it every other door, gate
  and stair landing on the same patch of floor. `buildNav` on a three-storey
  generated high school takes about 10ms.
- **The room node survived, and stopped measuring.** It is still a name, still
  something an agent can be assigned to, still somewhere to stand with nowhere
  to go. It is now one more anchor on one more tile, and a route that merely
  passes through a room no longer visits it.
- **A stair charges its climb on the upper anchor** rather than splitting it
  across two edges. Walking past the foot of one is therefore free, which is
  what it should always have been, and the total up-cost is unchanged.
- **Three exported functions got better for free.** `waypoints` reads which
  side of a doorway it came out on from the *edge* it arrived on rather than
  from the node before it — under the portal graph the node before a door was
  always one of the two rooms it joined, and on the mesh it is whatever was
  last standing beside it. `route` starts from where the walker actually is,
  by hanging a one-node overlay on the tile under their feet, instead of from
  the middle of the room they are in. And `pointField` is new: how far it is
  out of the building **from a point**.
- **The numbers moved, and by about what Phase 8 said they would.** Travel
  distance was the room's hub distance plus the room's own radius, which
  counted the room twice over. Measured from every point in the room over the
  mesh instead, a generated three-storey high school loses a mean of 9ft per
  room and 60ft off its worst one. "Ten to twenty feet" was a fair estimate of
  the middle of that distribution.
- **`egress.js` stopped asking the graph what doors a room has.** A door at the
  far end of a long room is a neighbour of the *tile* it stands on, not of the
  room, so counting a room's graph neighbours would have counted the doors near
  its middle and missed the rest. `nav.portalsOf` answers by construction.
- **A finding with nothing to point at is not a mark.** "Three exits where four
  are needed" is about the design rather than about a place in it, and drawing
  it somewhere would invent a location the report never claimed. Two findings
  gained the ids they had always been able to carry and never did — the
  narrow-exit warning now names its doors and the under-3ft doorway note names
  its doorways — so "*that* door is the one too narrow" is a thing the map can
  say.
- **The courtyard's ring is double-loaded, and that is the decision that makes
  it a courtyard.** Single-loaded was the first draft and it was wrong: a ring's
  capacity grows with its perimeter while its court grows with the square of
  it, so a six-hundred-pupil school came out with a two-hundred-foot quad and a
  walk right round it. Rooms on both faces of the loop, and the court is a
  light court.
- **Width is set by the frontage, height by the roll.** The blocks want a long
  north face and there is only one of it, so the courtyard's width falls out of
  them the way the spine's length does; the only dimension still free is how
  far down the sides run. Insisting on a square court is what turned a school
  with a gym in it into a quadrangle.
- **Adjacency is a pass over the finished layout, not a constraint threaded
  through the dealing.** The schemes deal rooms into runs round-robin by kind,
  and teaching a round-robin about pairs turns one legible loop into three
  scheme-specific ones. A swap after the fact costs nothing, is the same
  operation in all three schemes, and — the part that matters — can *say
  whether it worked*.
- **A swap exchanges what a room is, never where it is.** Key, name and
  template move; which corridor the slot faces, whether it has an outside wall
  and how big it is stay with the slot, because those are properties of the
  hole and not of the thing in it. Which also means only same-sized rooms can
  swap, and blocks — all different sizes — cannot, so a pair of *those* is
  handled by reordering the row they are laid in.
- **Distances between rooms are measured edge to edge.** A ninety-foot gym
  beside a sixty-foot cafeteria has a hundred and thirty feet between their
  centres and a shared wall between the rooms, and only one of those two
  numbers is what anybody means by "next to".

### What fought back

- **A flood region can wrap around a wall.** A C-shaped corridor is one region
  to `floodRegion`, and its two arms sit either side of the wall it wraps —
  so a rectangle grown across them is a hole punched through the building.
  Growing a tile therefore checks the lattice edge between every pair of cells
  it swallows, and a polygon's tiles check the ring segments the same way.
- **`splitCorridor` was dropping the junction at the far end of every corridor
  it cut.** It gave each segment after the first a door back to the one before
  it and kept only what the caller asked for on the *first* segment. A spine
  never noticed, because a spine is a tree. A ring came back as a horseshoe:
  the north and south halls of the first courtyard were joined only by going
  outside, and the report's egress numbers were fine because every stair tower
  has an exterior door. Found by asking whether every room could reach every
  other room *without* leaving the building — which is now a test.
- **A courtyard is not a way out.** This tool's outside is one node, so a door
  onto an enclosed court reads to `egressField` as a door onto the street and a
  fire drill "evacuates" into a sealed yard. `cutShellExits` now takes a list
  of sides to leave alone, and those walls get windows.
- **Both new schemes silently dropped a block that would not fit.** A courtyard
  school came out with no library, and nothing said so. Both now carry the
  widest block as slack when sizing the band it goes in — a block cannot
  straddle a cross hall or an exit passage — and report anything still over as
  `unplaced`, the way the spine always has.
- **A four-hundred-foot block with its ways out at the ends is a
  travel-distance failure**, and so is an upper storey whose only stairs are in
  its corners. Both were the same fix twice: a cross hall through the whole
  depth every hundred feet or so on the compact block, an exit passage through
  the middle of each long band on the courtyard, and a stair in each of them.
  Worst travel on a two-storey compact block went from 418ft to 219ft.
- **A stair and a lift in line need forty feet of hall and a tower has
  thirty-two.** They stand beside each other across the tower's width instead.
  The first draft put them on top of each other and the lift was quietly not
  added, which surfaced three checks later as "every room upstairs is reachable
  only by stairs".
- **A room whose name the use table cannot read is counted at 100 ft² per
  person and reported as unnamed** — which is how "North Passage" turned into
  five unnamed rooms. It is called an exit *hall* now, and the word "hall" is
  in the circulation row.

### Deliberately left for later

- **The mesh is inscribed, not exact.** A polygon room's tiles are rectangles
  sampled on a 2ft lattice, so a diagonal or curved wall is approximated from
  the inside and the walk along it is a little long. A proper convex
  decomposition of the polygon would fix it and would also give Phase 11 a
  hiding place behind a curve.
- **Gates are midpoints, not funnels.** A route across two tiles goes through
  the middle of the seam between them rather than round the tightest corner it
  could. String-pulling over the tile chain — the standard funnel algorithm —
  would shave a few feet off an L-shaped walk. Nothing measures it yet.
- **`findPath` still sorts an array for its open set.** At three hundred nodes
  that is the right trade and it is written down where it happens; at three
  thousand it would not be, and the mesh is what would get it there.
- **The compact block cannot always honour an adjacency rule**, and says so. It
  is a dense plan: "away from" wants a hundred and fifty feet of building
  between two rooms and there often is not that much of it in any one
  direction. That is a property of the scheme rather than a bug in the pass,
  which is exactly why the pass reports per-rule rather than pass/fail.
- **Adjacency cannot move a room into a bigger slot.** Only same-sized rooms
  swap, so "the band room next to the library" is unachievable when no slot
  beside the library is band-room-shaped. Growing a slot means re-running the
  packing, which is the constraint-threaded-through-the-dealing design this
  deliberately is not.
- **A fourth scheme.** The contract is `rects`, `links`, `exits`, `footprint`,
  `entry`, `envelope` and `style`, and the four shared functions do the dealing;
  a tower plan or a campus of separate blocks is that list and its own geometry.
  The campus one is the interesting one, because it is the first scheme where
  the building is not one connected thing.
- **The minimap's findings overlay draws one finding at a time.** All of them
  at once would need a legend and a way to resolve two washes over the same
  room, and the report panel beside it already prints the list.

## Phase 11 — Play

The rest of the list shares a different sentence: **the building is finished
and nobody is playing in it.** A school you can walk through, hear and
analyze is still a place you visit rather than a place you mess with. Nothing
here is load-bearing, and that is the whole idea.

No save bump here either — physics and a hunt are runtime state, and a decor
pack is more catalog rows.

- [ ] **Colour variants in `data`** — the open item from Phase 1, and the
  prerequisite for the bottom of this list. `cleanData()` (`props.js`)
  already validates the field; what is missing is a reader for `data.color`
  and a variant-aware key in `getPropGeometry()` (`render.js`), which today
  caches on `entry.type` alone and bakes the row's colour into the vertices.
  Then a swatch in `propedit.js` and the matching fill in `blueprint.js`.
- [ ] **Light prop physics** — bump a chair and it scoots. `collide.js`
  already resolves a walker against the world; this is that arithmetic
  pointed the other way, on props flagged light enough to move, with no
  solver, no stacking and no persistence. Pure delight, and the one item on
  either list with no downstream consumer at all.
- [ ] **Scavenger hunt / hide-and-seek over the nav graph** — a reason for a
  kid to explore the building a parent just designed. It wanted Phase 10's
  mesh underneath it and now has one: a hiding place is a property of a
  walkable surface rather than of a room's centroid, and `navmesh.js` hands
  over that surface as rectangles — `nav.tileAt(floor, x, z)` says which one
  you are standing on and `nav.mesh[i].byRoom` says what a room is made of.
  "Behind the bleachers" is still unsayable, because furniture is not in the
  mesh; "the far end of the third tile of the gym" is not.
- [ ] **Holiday decoration packs** — the Decor category, seasonal. This is
  the colour-variant item wearing a hat: a pack is a handful of rows and a
  palette, not a handful of new builders. Which is the argument for doing the
  variants first rather than shipping thirty near-duplicate catalog rows.

*Leans on:* the catalog's `data` field, the walker's collider, and the tiles
Phase 10 left behind as a walkable surface;
*collides with:* nothing — rare enough to be worth saying. This is the first
phase in either arc that no other phase is waiting on.

## Suggested build order

Phases 1 through 10 are done, bar two items: colour variants in `data`, which
Phase 11 carries, and real-time collaboration, which needs a server. Phase 1
shipped *first*, out of order and in one commit, before Phase 2 — which is
worth stating plainly, because earlier revisions of this paragraph spent two
phases calling it the thing that never got built and the obvious next thing to
do. It was neither. Every phase after it leaned on it.

Phase 7 turned out to be exactly the right thing to build in front of the
generator, and the claim held literally: occupant load per room is what sizes
the stairs (`generate.js` calls `roomOccupancy` on its own rectangles before it
has written a single tile); travel distance is what decided that every wing
gets a stair tower at *both* ends rather than one; and the report is what says
which of two seeds produced the better school. Seed a plan, read the report,
move a door, read it again — that loop is the whole of parametric design and
both halves of it now exist and are wired to each other.

What Phase 8 left for whatever came next was three things, and Phase 10 did
all three: the nav mesh Phase 6 and Phase 7 had both wanted, the second and
third layout schemes, and adjacency in the brief. The estimate attached to the
first of them — ten to twenty feet of travel distance nobody walks — turned out
to be a fair reading of the middle of the distribution: a generated
three-storey high school lost a mean of 9ft per room and 60ft off its worst
one.

Phase 9 is done, and what it leaves behind is a shorter list than it started
with. Sharing is a link, the building leaves as a file, furniture arrives as
one, the camera can be recorded and the school can be stood in at full size.
What did not get built is the one item that needs a server — and the finding
worth carrying forward is that collaboration is blocked on *this* side of the
wire too: grid cells have no identity, so there is nothing to name when two
people edit the same room. That makes it downstream of the decision to promote
every room to a polygon, not downstream of a sync library.

Phase 10 is done, and the argument for splitting it from Phase 11 rather than
doing one big final phase held: `navgraph.js` has ten consumers and a chair
that scoots has none, so a single phase would have made the fun half wait on
the review pass for the risky half. The risky half needed that pass. Three of
the seven things under "what fought back" were bugs one item's tests found in
another item's code — the horseshoe ring, the vanished library, the lift that
was never added — and none of them would have been as visible in a phase that
also had a scavenger hunt in it.

That leaves one open band: **Phase 11, where it gets fun to be in.** Nothing is
waiting on it and it is waiting on nothing; the mesh it wanted underneath the
hunt exists, and the colour variants it carries from Phase 1 are the only
prerequisite inside it.

And the finding that made the split free, which fell out of auditing the
remainder rather than out of building anything, held too: **nothing left on
this list needs a save-format bump.** Phase 10 changed no bytes — the mesh is
derived, and the generator's brief, program, scheme and adjacency rules are
transient (`save-load.js` mentions none of them). `cleanData()` already
validates `data.color`; physics and a hunt are runtime state; a decor pack is
rows. Six of this arc's ten phases were shaped in part by the cost of a
version bump and the wish to spend it once — Phase 5 in particular reads the
way it does because terrain, site and roof all had to land in v7 together.
That pressure is simply absent now, as it was for Phases 4, 7 and 10.

The three chores Phase 9 left behind — audio in the tour capture, the
minimap's phone layout, and an `EXT_mesh_gpu_instancing` export — belong to
no thesis and should ride along with whichever phase is open when somebody has
a spare hour. The middle one grew a little in Phase 10, which added a second
button row and a caption to the same panel. They stay listed under Phase 9's
"deliberately left for later", where they were found, along with Phase 10's
own two — the inscribed mesh and the un-funnelled gates. Moving any of them up
here would start exactly the second list this document keeps warning about.
