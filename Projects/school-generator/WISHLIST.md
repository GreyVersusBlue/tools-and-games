# School Generator — Feature Wishlist

Living reference for where this tool goes next. The first arc of this project
— eight phases, from a single-floor grid editor to a multi-story, furnished,
polygon-roomed building you can blueprint, save, and walk through on desktop
or touch — is **done**. This document is now two things: a compact
retrospective of that v1 build (what shipped, what worked, what fought back,
what a future builder needs to know), and a fresh phase system for everything
after it, starting with a much bigger prop catalog and running through the
genuinely pie-in-the-sky.

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
`libs/addons/postprocessing/DepthOfFieldPass.js`.)

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
  and floor edges; `supportAt()` answers slab/tread/site, stairs walk as
  ramps, `F` toggles the old no-clip ghost. Touch devices get a joystick +
  drag-look instead of Pointer Lock.
- **Saves are versioned** (v4) and every bump has been additive, with
  `deserialize()` clamping hostile input and migrating v1–v3 forward. Named
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
  in saved state.

## Phase 1 — Prop catalog expansion (high fidelity, real scale)

The catalog has 14 types — enough to prove the layer, nowhere near enough to
furnish a school. This phase makes it a real furniture library: **~70 new
types**, every one at real-world dimensions, with a visible step up in
geometric fidelity while staying procedural and instanced.

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

## Phase 4 — Sound

- [ ] The bell. Of course the bell.
- [ ] Footsteps by surface (slab vs stair tread — `supportAt()` already
  knows), doors from Phase 2, ambient room tone.
- [ ] Reverb sized to the room the walker is in — room identity and area
  exist (`floodRegion`/`shapeArea`); map volume to a convolver preset.
- [ ] PA announcements and hallway ambience as placeable/ambient sources
  with distance falloff (`THREE.PositionalAudio` handles the spatial half).

*Leans on:* the walker's existing surface and room queries; no save-format
change unless sources become placeable props (then they're just catalog
rows with a `data.sound`).

## Phase 5 — The site

- [ ] Terrain: a heightfield under and around the slab — `supportAt()`'s
  "the site" answer becomes a lookup instead of a constant 0.
- [ ] Hardscape: parking lots, bus loop, walkways, ball-court markings —
  flat colored/striped regions, plausibly polygon rooms with a `site` flag
  rather than a new geometry system.
- [ ] Sports fields with line markings, plus the Phase 1 outdoor props
  (playground, benches, racks) getting somewhere real to stand.
- [ ] Landscaping: trees/hedges as instanced props (they're just catalog
  rows with `site` mount semantics).
- [ ] Roofs and facade styles: parapet vs pitched, brick/panel/stucco
  facade materials — the exterior stops being extruded wall tops.

*Collides with:* the flat-site assumption in `collide.js`, the
footprint-bounded grid (polygon site regions already escape it, the way the
Learning Commons does), and the blueprint (a site plan page is a natural
addition).

## Phase 6 — A living school

The walker stops being alone.

- [ ] Ambient students and teachers: capsule-simple bodies, walking the
  halls, sitting at the Phase 1 desks (which is why seats are separate
  objects), using doors.
- [ ] Navigation derived from the model: rooms, doorways and stairs already
  describe a nav graph; `collide.js`'s pure walker becomes a shared body
  resolver for N agents, not just the camera.
- [ ] The bell schedule: periods, passing-period crowd surges, a clock that
  drives Phase 3's sun and Phase 4's bell.
- [ ] "Day in the life": pick a generated student, follow their timetable
  first-person or over-the-shoulder.
- [ ] Fire drill: everyone routes to the nearest exit; slow spots and
  door-width bottlenecks render as a heatmap — the playful face of Phase
  7's egress analysis.

*Collides with:* `collide.js` being camera-only and the collider's
build-once lifecycle; performance wants instanced skinned crowds (or
rigid-part puppets, which instance trivially).

## Phase 7 — Analysis & rigor

The tool starts answering "is this a *good* school building?"

- [ ] Egress checks: travel distance to the nearest exit from any point,
  door widths against occupancy, dead-end corridor detection — all
  computable from the same model the blueprint reads.
- [ ] ADA/accessible routes: can a wheelchair (no stairs, ramp/elevator
  links only, door widths) reach every room? Phase 2's ramps and elevators
  make the answer sometimes-yes.
- [ ] Capacity: per-room occupancy from area and room label; a roll-up per
  floor and building.
- [ ] Cost / bill of materials: walls by the foot, glass by the bay, props
  by the row — a spreadsheet-ish export beside the blueprint.
- [ ] Daylight and acoustics first passes: window area per room area,
  reverb estimates from volume — honest approximations, labeled as such.

*Leans on:* `computeFloorPlan`'s model-not-pixels approach — every analysis
is another pure reader over the same state, and belongs in a headless
module with tests, per the house rule.

## Phase 8 — Generation & AI

The name of the tool, finally cashed in.

- [ ] Parametric school generator: seed + student count + grade band +
  site shape → corridors, classroom wings, gym/cafeteria/library/office
  blocks, stairs where they're needed, every room furnished from its
  label's template. `sample.js` is the proto-generator; templates are the
  furnishing vocabulary.
- [ ] Auto-furnish one room from its label ("make this a science lab") —
  the generator's smallest useful piece, shippable first.
- [ ] Prompt-to-floorplan: natural language → parameters (and maybe room
  adjacency wishes) feeding the same generator — the model stays the
  contract, so generated output is just a design like any other.
- [ ] Generate-then-edit is sacred: output is ordinary state — rooms,
  props, links — never a special "generated" object.

*Leans on:* room labels, templates, and the additive save format;
*collides with:* nothing structurally, which is exactly why the phases
before it matter.

## Phase 9 — Sharing & beyond the tab

Each item here prices the no-build-step, no-deps stance explicitly.

- [ ] glTF prop import (`GLTFLoader` is an addon, vendorable like the rest
  of `libs/addons/`) — `assets/models/` finally earns its keep; catalog
  rows point at a file instead of a `geo` key.
- [ ] Whole-building glTF export — take the school into Blender.
- [ ] Link-encoded sharing: a design compressed into a URL fragment for
  small designs; cloud saves are the grown-up version and the first item
  that needs a server.
- [ ] Real-time collaboration — the big one; needs a sync layer and
  per-object ids (polygon rooms and props have them; grid cells don't,
  which is the hard part).
- [ ] WebXR walkthrough (`renderer.xr` is core three.js) — the school at
  1:1 scale in a headset; the real-scale discipline of Phase 1 is what
  makes this land.
- [ ] Guided tours: record camera paths, play them back, export video via
  `MediaRecorder` — no new deps.
- [ ] Minimap while walking, from the blueprint renderer at thumbnail size.

## Phase 10 — Play

- [ ] Light prop physics: bump a chair and it scoots; nothing
  load-bearing, pure delight.
- [ ] Scavenger hunt / hide-and-seek modes over the nav graph — a reason
  for a kid to explore the building a parent just designed.
- [ ] Holiday decoration packs (Phase 1 decor category, seasonal
  variants).

## Suggested build order

Phases 1 and 2 are done. Phase 3 (light, sky and atmosphere) is next by the
default ordering, and the windows Phase 2 just put in every exterior wall
are exactly what a sun study needs something to shine through.

Phase 1 first: it's pure content on a proven pipeline, no schema risk, and
almost everything later (seated NPCs, furnished generation, VR at 1:1)
gets better the richer and more accurately scaled the catalog is.

Phases 2–10 are ordered structure → atmosphere → simulation → analysis →
generation → sharing → play: each band leans on the ones before it (NPCs
need doors and nav; analysis needs ramps and elevators; generation needs
templates worth stamping). But the ordering is a default, not a law —
phases 3, 4 and 9's smaller items (photo mode, the bell, glTF import,
minimap) are self-contained enough to pull forward whenever one is wanted.
