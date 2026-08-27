# School Generator — Feature Wishlist

**Status: twenty-five phases are shipped — three arcs, all of arc four, and
one after it.** Three arcs took a grid editor to a walkable, furnished,
generated, priced, networked school. Full history —
what each phase did, what fought back, why phases were ordered the way they
were — lives in `git log -p WISHLIST.md`; this file keeps what a builder
needs going forward — the architecture, the conventions that were learned the
hard way, and the standing backlog — and now ends with the shipped arc
rather than only a backlog.

## What it is

A single-page tool at `Projects/school-generator/index.html`. No build step,
no dependencies beyond a vendored three.js, and nothing to install — push the
file and it is deployed.

It does need to be **served**, which this file used to claim it did not: the
tool is ES modules, and a browser refuses those over `file://`, so opening
`index.html` off the disk gets you the chrome and nothing behind it. Any
static server will do — `npx serve`, `python3 -m http.server`, whatever is
already on the machine. (The `server/` directory is a different thing
entirely: the design store and the session relay, both optional.)

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
per-segment walls) · `wallrun.js` (a wall drawn point to point, and the
free-standing ones a room's boundary cannot say) · `snapgrid.js` (the
drawing grid's pitch, and the point a tool aims at) · `lattice.js` (the 4ft
drawing surface, and `bake()`, the one door out of it) · `paint.js` (the
brush) · `props.js` (object layer,
inter-floor links) · `catalog.js` (every placeable type, as data) ·
`walls.js` / `openings.js` / `finish.js` (derived thickness, door leaves,
window bands, floor/paint) · `stairs.js` (runs, landings, the holes they cut)
· `terrain.js` / `site.js` / `roof.js` (ground, site drawing, roof) ·
`rates.js` (cost vocabulary) · `history.js` (an edit as a diff) ·
`save-load.js` (v12, one migration that ever changed a shape).

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
call button and a queue) · `haunt.js` (Phase 24's night: the stage machine,
the writings, the crash, the way out) · `creature.js` (the one body in it).

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
- **The walkthrough collider's walls are built once at walk-start; its props
  can be invalidated.** *Structural* editing and walking are exclusive —
  rooms, walls and storeys still never change mid-walk. Furniture can (Phase
  22's hands), and `refreshProps` in collide.js is the one door for it: prop
  obstacles re-derived from the design in place, walls and the live door
  leaves untouched. The crowd owns the colliders when it is running — which
  is exactly what makes one refresh reach the camera and every agent at once.
- **Ctrl-combos route through `main.js`,** not through the tools' generic key
  handling.
- **Undo restores a snapshot with `Object.assign`, which only ever adds.**
  Any *optional* record on the state (`terrain`, `site`, `roof`, `life`,
  `timetable`, `overlay`, `models`, `tours`, `haunt`) has to be deleted when
  the snapshot doesn't have it, or undoing past the moment it was first
  written silently does nothing.
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
- **There are three test passes, and a tool belongs to the third.** `node
  --test 'test/*.test.mjs'` is the numbers (and the glob is not decoration —
  `node --test test/` dies with `MODULE_NOT_FOUND` on Node 22).
  `test/visual/run.mjs` is the pictures. `test/tools/run.mjs` is the *tools*:
  the twelve of them driven with real pointer events on the real page,
  because `editor.js` and the six `*edit.js` modules all import three.js and
  so cannot be loaded in Node at all. If you change what a tool does to the
  state, that is the pass that will tell you. All three run in CI on every PR
  that touches this directory; the last two need Playwright and are optional
  locally — a machine without a browser loses them, not the suite.
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
- A title-block panel prints its three worst findings and counts the rest;
  the full list still lives only in the report panel and the CSV.

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
- ~~Warmth is a straight line plus a per-storey charge, not routed, so
  something thirty feet away through a wall reads as hot.~~ *Done, Phase 24:
  `routedDistance` walks the navgraph; the straight line survives only as the
  no-graph fallback and the outdoors' answer.*
- A colour variant cannot recolour an imported model; a prop has one paint.
- The crowd cannot shove anything.
- Hands are desktop-only — touch has no Q, and the palette ring belongs on
  the touch HUD beside the joystick it doesn't yet have.

**Light, sound and picture**
- There are still no shadows from the building's own lights, and light
  doesn't respect geometry, only distance — a troffer shines through the
  wall its range crosses.
- The cloud deck is one coverage and one drift everywhere — no weather, no
  wind, no overcast day.
- Transmission loss ~~is one number per situation rather than a ray cast~~
  *(the ray landed in Phase 24 — `pathLossRay` counts sightline's segments
  and the live leaves; the constant survives as the cross-slab and
  no-geometry answer)*, and there are still no early reflections.
- The phone got photo mode and the minimap (and, it turned out, the ability
  to boot at all — a missing element had been a TypeError on every touch
  device); the topbar and the tool panels are still desktop-shaped.

**The room model**
- ~~A boundary that bounds no room cannot be drawn.~~ *Closed by Phase 25:*
  `floor.walls` is a boundary that belongs to the storey. What it still does
  not do is bound anything — a wall line drawn across a room does not divide
  it for flood fill, egress or daylight, because it is not part of any ring.
  Draw a room's own boundary and the run lands on the ring instead, which is
  where dividing a room actually happens.
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
- ~~The wall drag's parallel-segment fix isn't applied to the erase tool.~~
  *Moot since Phase 25:* there is no wall drag. The eraser still strokes,
  and still takes whichever boundary is nearest each sample.
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
- The walk export ships three.js as source — 2.6 MB that would be a quarter
  of that gzipped, if a compressed variant is ever worth the complication —
  and leaves the headset out: `xr.js` rides the bundle but no VR button does.
- **Most of the tool still loads before the first frame.** `lazy.js` exists
  and `generate.js` (the largest module, 108 KB) now arrives when somebody
  presses Go, but the boot payload is still ~3.5 MB over a hundred requests.
  What stops the rest is not the mechanism, it is the import graph — the
  obvious candidates are each pinned eager by something on the boot path:

  | module | pinned by | what it would take |
  | --- | --- | --- |
  | `blueprint.js` (54 KB) | the **minimap**, which calls `computeFloorPlan` / `drawPlanBody` every frame in walk mode | a plan cache the minimap can fill asynchronously, or its own tiny plan builder |
  | `agents.js` (61 KB), `timetable.js`, `phasing.js`, `rates.js`, `tour.js`, `models.js`, `haunt.js`, `occupancy.js` | `save-load.js`, which normalizes each of their records on load | a registry the loader consults, so a record is normalized by the module that owns it once that module is present |
  | `gltf.js` (29 KB), `hunt.js`, `xr.js` | `render.js` | the scene asking for them at the moment it draws one, not at import |
  | `report.js` and its tail (`cost`, `spec`, `egress`, `daylight`, `utilisation`, `takeoff`) | `main.js`'s panel renderers, which are synchronous | the panels becoming async, which is the same shape of change as the Generate button |
  | the collab stack — `session`, `wire`, `presence`, `cloud` (54 KB) | ~50 call sites in `main.js`, one of them (`createRoster()`) at module top level | a `collab` object built on first use rather than at load |

  None of it is hard; all of it is in the untested tool/UI layer, so do it
  behind `test/tools/run.mjs` rather than in front of it.
- The vendored `libs/` are 1.3 MB — 36% of the payload — and cannot be cached
  hard because the paths carry no version. Putting the version in the
  directory name would buy an `immutable` year on every return visit, and
  costs one edit to the import map plus a rebuild of `walk-template.html`.

## Arc four — the guest

Three arcs built a tool for the person who draws it; nothing yet is built
for the person who is handed the result. Every phase so far assumed the
builder — somebody who found the cheat sheet, learned twelve tools, and has
the file open in a tab of their own. The six phases below share the other
person: the visitor in their first five minutes (Phase 19), the eye that
decides whether to stay (Phase 20), the walker who should learn the building
by walking it rather than reading it (Phases 21 and 22), the friend with no
tool at all (Phase 23), and — as an *and also*, the way arc two ended on
Play — the player in the dark (Phase 24).

**Phase 19 is the self-contained win** — reach for it any time; it leans on
nothing below it. **Phase 21 was the quiet prerequisite, and it is shipped:**
its sightline module is the thing Phase 24 hunts you with. **Phase 23 was
called the architectural risk of the arc — the biggest single piece of
surgery since the nav mesh — and shipped without needing the surgery:** see
its closing note for why the risk never materialised.
**Phase 24 is an and-also: skip it and the arc still closes.** Two of the
six phases claim no backlog item at all — the guest was never on the list.

One convention is new with this arc, and it is about phases rather than
code: **each phase names the Claude model that should run it.** The rule is
that anything touching the model layer — a new pure module, the save format,
the collider contract, visibility math, the export bundler's module
surgery — runs on Claude Fable 5; surface work — DOM wiring, CSS, render
presets — runs on Claude Opus 5 or Claude Sonnet 5. No phase in this arc is
small enough for Haiku, and that is a judgment, not an oversight.

## Phase 19 — The first five minutes *(shipped)*

**The tool rewards the hundredth hour and punishes the first five minutes.**

Twelve tools, four analysis panels, and dozens of walk-mode hotkeys exist,
and every one of them is taught the same way: a `<kbd>` cheat sheet you must
already know to look for. A new visitor gets a blank 4ft lattice and a
toolbar of nouns, while the two best first experiences the tool owns — the
sample school in `sample.js`, and `generate.js` reading a whole building out
of one sentence — are hidden behind knowing they exist. The phase is judged
by one test: somebody who has never seen the tool reaches a walkable school
in five minutes without opening this file.

- [x] **An opening moment.** First visit with no autosave offers three doors —
  walk a sample school, generate one from a sentence, start with a blank
  sheet — the existing `sample.js` and `brief.js`/`generate.js` behind three
  buttons instead of an empty lattice.
- [x] **A command palette.** Ctrl-K, fuzzy-matched over every tool, verb and
  toggle `main.js` already wires; every result shows its hotkey, so the
  palette *is* the cheat-sheet tutor.
- [x] **One hint at a time.** The per-tool `<kbd>` panels fold behind a
  "Keys & tips" disclosure, and a coach surfaces the single next-useful hint
  on the status line at the moment it applies (first prop placed →
  "R rotates"), once per browser.
- [x] **The walk-mode sheet gets an audit.** Hotkeys grouped by how soon a
  guest needs them (First steps / Seeing more / People & time / Play &
  capture); the lift says its own E on the HUD when you stand at its doors.
- [x] **Photo mode and the minimap learn the phone.** The photo panel is a
  two-column top sheet on a narrow viewport; the minimap shrinks and, on a
  touch walk, moves out from under the joystick.
- [x] **Findings go where the eye is.** The title-block panels print their
  three worst findings in words (`panelFindings` in report.js), and an open
  finding in the report panel carries "⌖ Show it on the plan" — the editor
  pans to the room, the walkthrough lights it on the minimap.

*What fought back:* running the tool on an actual phone found that it never
booted on one — `main.js` had written a touch hint into an element two
redesigns had removed, a TypeError before init finished. And the chrome pass
found `--accent-soft` defined as `var(--accent-soft)`: every active-state
wash had been transparent for two phases. Both are the kind of bug only
*looking* finds, which is what the phase was. *Save:* — none, as planned;
three localStorage flags (`sg-welcome-seen`, `sg-hints-said`, and the visual
harness pre-seeds the first). The palette routes through the same handlers
the hotkeys call — no rival keymap — and is under the visual harness as
`chrome-cmdk`, with the opening moment as `chrome-welcome`.

## Phase 20 — Worth a screenshot *(shipped)*

**The picture is honest. Honest is not yet worth looking at.**

The composer already runs SSAO, bloom and depth of field; what is missing is
not another pass but character — materials with grain, light with a time of
day, a sky that is more than a gradient, and chrome that looks like it
belongs to the pictures the tool makes. Everything here writes state that
already exists: the `env` record already knows the sun, the date and the
exposure, and this phase gives it five good answers instead of six sliders.

- [x] **Time-of-day moods, one click each.** Morning / noon / golden hour /
  dusk / night — `MOODS`/`applyMood` in sky.js write the existing `env`
  record whole (the time *and* the lights settled), and the row renders in
  both the sky panel and photo mode.
- [x] **Troffers that light.** `trofferSources` in lights.js walks the same
  8ft lattice the renderer bakes its ceiling pans on, and the budget carries
  them by default — clustered per room, ranked against placed fixtures, the
  unbudgeted rest spilling into the ambient fill honestly. The flat
  `HOUSE_FILL` guess is gone: the night fill is now the ceiling's own spill.
- [x] **Clouds worth having, or none.** A four-octave value-noise fbm shader
  on a second shell of the sky dome — no texture, no pass, colours from the
  same palette table as everything else, still under prefers-reduced-motion.
- [x] **Materials with grain.** `makeFinishRoughness` gives each finish
  family its own sheen map (matte pile on carpet, per-plank satin on wood,
  polish with matte chips on terrazzo) where every floor had shipped wearing
  VCT's semi-gloss; standing-seam metal facades take a low-sun glint.
- [x] **The chrome earns the scene.** Panels read as dark glass (hairline
  top light, deeper drop), native selects and scrollbars claimed, active
  states actually visible — see the `--accent-soft` bug under Phase 19.

*What fought back:* the first night walkthrough was white. Real troffers per
pan plus a spill that every school now saturates plus the night exposure
lift stacked into a washout, and the tune that landed is stated in
lights.js: 1,000lm a pan (a four-pan cluster ≈ one real 2x4) and `SPILL_MAX`
down to 0.30 — the level the old invented house fill sat at, now earned.
*Save:* — none, as planned; a mood writes fields v11 already has.

## Phase 21 — Line of sight *(shipped)*

**A label the walker did not earn is information through a wall.**

Room labels are `depthTest:false` sprites filtered to the camera's storey —
in walk mode they named rooms you have never seen, through the walls that
hide them. The fix: in walk mode a room's label is gated on unobstructed
line of sight to that room's door. Doors are already known to `openings.js`
and the navgraph; the walls that occlude are already derived as segments by
`collide.js`; what is new is one pure module. It is worth saying now that
Phase 24 is waiting for exactly this module.

- [x] **`sightline.js`, pure, with its suite.** Given an eye point and one
  storey's occluders, answer "is this door visible?" — 2D segment casts in
  plan, storey-aware; a closed leaf occludes, an open one doesn't (the cast
  runs against `leafSegment` at the leaf's live angle, so both fall out of
  one rule). `doorPoints` names the rooms either side of every doorway;
  `makeLabelGate` is the walk's memory of what it has seen.
- [x] **Labels earned by sight, and a strict mode beside it.** The walk-mode
  default is *earned*: a label fades in when its room's door is first seen
  and stays learned for the rest of the walk — wayfinding, not a memory
  test. *Strict* shows a label only while its door is currently in sight,
  and *all* / *none* remain as overrides — `I` cycles the four, in the
  palette and on the walk sheet. Sprites keep `depthTest:false` for
  readability; the honesty now comes from the gate, not the depth buffer.
- [x] **Edit mode unchanged.** The drawing board keeps always-on labels; the
  walk-mode setting is a session decision that lives in the tool, never the
  file, and the gate itself is rebuilt per walk — earned labels last exactly
  as long as the colliders do.
- [x] **Throttle it honestly.** Casts only for ungated labels on the
  walker's storey, four per frame round-robin (`budget`), nearest door
  first — the walker moves at walking speed and nothing needs an answer
  every 16ms.

*What fought back:* two things, both geometric. A cast aimed *at* a doorway's
centreline never strictly crosses the shut leaf lying exactly along it —
`segsCross` is strict at endpoints, correctly — so the cast reaches
`DOOR_PAST` beyond the wall, through the hole or into the leaf. And the plan's
"the segments collide.js already derives" did not survive contact: sight has
its own idea of a wall. `wallSegments` puts glass and railings in with
drywall (right for a body, a lie for an eye) and never cuts a window, so
`sightSegments` derives its own occluders — glass and rails pass whole, a
window is a hole only where the eye height falls within its band, and a
clerestory stays a wall. A door on a shared partition belongs to one room's
ring and to *both* rooms' sight, which is `doorPoints` probing both sides the
way the navgraph's portals do. *Save:* — none, as planned; one localStorage
preference (`sg-labels`). *Model:* **Claude Fable 5**, as named.

## Phase 22 — Hands *(shipped)*

**In walk mode you have feet and no hands.**

All placement was edit-mode-only through `propedit.js`, yet the pure half —
`propplace.js`'s picking and three snap tiers — has never known what mode it
is in. The real obstacle was a convention, and this phase renegotiated it in
the open rather than sneaking past it: *the walkthrough collider is built
once at walk-start* gained an invalidation clause for props, and *editing and
walking are exclusive* narrowed to structure. Rooms, walls and storeys stay
edit-only; furniture became something you can do with your hands from
inside the building.

- [x] **A carry slot.** Point at a prop, Q picks it up — a real prop, unlike
  `shove.js`'s session-only scoot — it stands at its snapped set-down spot
  ahead of the view (`carry.js`, pure, with its suite), and sets down
  through `snapProp` with the same three tiers the editor gets. R turns it,
  X puts it back.
- [x] **A walk palette.** A short ring of catalog favourites on the digit
  keys (`WALK_PALETTE`, eight floor-standing pieces); the full catalog stays
  an edit-mode affordance.
- [x] **The collider learns invalidation.** Placing or removing a blocking
  prop rebuilds the cached storeys' prop colliders (`refreshProps` —
  walls and door leaves stay built-once), and reaches the crowd's collider
  too because they are the same objects. The convention bullet got
  rewritten, not violated.
- [x] **It writes the file.** A walk placement is a props edit like any
  other — history diff, undo (from edit mode), autosave, session op if a
  peer is connected — where a shove stays a session fact.
- [x] **You can trap yourself, and that's allowed.** Placement refuses only
  overlap, not consequence — `placementClear` tests the real rotated
  footprint against walls, live door leaves and blocking props, and nothing
  else; step-up and shove are the ways out, and the fire drill will tell
  you what your barricade did.
- [x] **A shove learns the real footprint.** `shoveClear` now tests the
  rotated box (shrunk a shade so flush contact can still slide) through the
  same overlap helpers the set-down uses, instead of a circle of the prop's
  half-width. Crowd-shoves stay open on the backlog.

*What fought back:* the rotation convention, again — under it local +x
swings toward −z, and the first overlap test was written for the other
handedness (read the note atop propplace.js *before* the test, not after it
fails). Escape turned out not to be cancellable: under pointer lock the
browser owns Esc, so putting a carried prop back is X. And the carried
ghost is not a floating prop but the real instance standing at its snapped
target — you look at exactly what a set-down commits, the editor's
footprint-plane ghost says whether it fits, and `moveProps` learned an
explicit `y` so a prop carried up a stair poses on the storey it is going
to. One deliberate consequence: a committed placement redraws the scene
from the file and refreshes the colliders from the file, so everything the
walk had *shoved* snaps back where it was drawn — the picture and the
physics agree, because they are read from the same place. *Save:* — none,
as planned (existing props records; no schema change). *Model:* **Claude
Fable 5**, as named.

## Phase 23 — The walk you can hand to somebody *(shipped)*

**Sharing the school still means sharing the tool.**

`share.js` proved a design travels without a server — but the link opens the
whole editor, toolbar and all. The ask is one self-contained `.html`: the
design, a walk-only runtime, and three.js, in a single file that opens from
`file://` with no network — walkable, not editable. The codebase has no
build step and this phase does not add one; it adds a bundler the codebase
writes itself, and the twenty-phase discipline that pure modules never
import three.js is exactly what makes the import graph severable. The honest
obstacle is `render.js`: 5,600 lines owning both edit and walk. The phase
may carry it whole or split scene-build from edit-only, and should refuse to
do more surgery than the export needs.

- [x] **`walk-main.js`, a second entry point.** Boots straight to
  pointer-lock walk from an embedded design: deserialize → build → walk.
  Keeps collision, doors, the lift, footsteps and acoustics, the sun,
  labels-by-sight, shove, the minimap, photo mode, the crowd toggle — and
  with the crowd, the fire drill (K), follow (V), the bell and the PA, plus
  Phase 20's moods riding the photo panel. Leaves every editor tool,
  generation, analysis, the session stack — and Phase 22's hands, which
  write a file that doesn't exist there. The minimap came without its
  findings layer for the same reason: findings are the report's, and the
  report is analysis.
- [x] **`tools/export-walk.mjs`, the house bundler.** Walks the static
  import graph from the entry point, topologically sorts it, and rewrites
  each module into an IIFE returning its exports — imports become const
  destructures of the modules already evaluated, `libs/three.module.js` and
  its addons ride along as modules like any other — into one
  `<script type="module">` spliced into `tools/walk-shell.html`. The design
  travels as `share.js`'s deflate-base64url payload in its own text script
  tag. `test/export-walk.test.mjs` bundles on every run and asserts the
  graph closed, severed cleanly (editor, generator, session and analysis
  all stayed home), and parses as one strict script.
- [x] **An export button, no node in sight.** `walk-template.html` ships
  beside index.html — built by the same script, committed like a fixture,
  with a byte-for-byte staleness test that says exactly what to run when it
  drifts — and the Share dialog's "Download walkable .html" fetches it,
  splices the current design in at the one marker both sides pin, and
  downloads. The tracing image stays home (it never draws in a walk);
  imported models come along, because a file has no 60 KB ceiling.
- [x] **A budget, stated.** The committed template must stay under 4 MB
  (`TEMPLATE_BUDGET`, enforced by the suite); it landed at 2.6 MB — 67
  modules, half of them three.js — so a finished export with a generated
  school's ~50 KB payload passes any chat client's file limit with room to
  spare. The real targets held too: the exported file opens from `file://`
  with zero network requests and zero console errors, verified in headless
  Chromium.
- [x] **Old exports open forever.** The exported file embeds its own
  deserializer and its own codec — the graph test pins `save-load.js` and
  `share.js` into the bundle — so a v12 tool keeps producing exports that
  don't care what v13 looks like.

*What fought back:* less than the plan feared, and the plan gets the credit:
twenty phases of house style meant the graph had no default exports, no
re-exports, no `export let` and no cycles anywhere in the walk's reach, and
the vendored three keeps its hundreds of exports in one final statement — so
the "biggest single piece of surgery since the nav mesh" was four regexes
against a discipline, and `render.js` was carried whole rather than split
(2.6 of the 4 MB budget said the split wasn't needed, and the phase was told
to refuse surgery the export didn't need). The one real scare was a black
viewport in the headless smoke test — chased into the *tool*, where
`test/visual`'s own chrome-edit baseline turns out to have the same black
viewport: a SwiftShader artifact, identical on both sides, and the export's
scene draws fine where the tool's does. *Save:* — none, as planned (embeds
v11 as-is). *Model:* **Claude Fable 5**, as named.

## Phase 24 — Lights out *(shipped)*

**A building that can host a school day can host a bad night.**

This is the arc's *and also*, the way arc two ended on Play: nothing later
leans on it, skipping it costs the arc nothing, and it ships off by default
behind its own switch. The argument for planning it anyway is that horror is
the cheapest total conversion this codebase could buy. It already owns a
crowd that pathfinds, positional audio with per-room reverb, a sun that
sets, doors that open on approach, seasonal decals — and, after Phase 21, a
module that knows what you can see. Combined with Phase 23, the payoff line
writes itself: hand a friend a haunted school as one file.

- [x] **A `haunt` record, additive, off by default.** `{ on, seed,
  intensity }` — save v12, the cheap append kind — and it joins the undo
  delete-list of optional records, per the `Object.assign` convention.
- [x] **Something in the building.** One creature that walks the navgraph
  like anyone else, except it prefers the corridor you are not looking
  down — `sightline.js` inverted. Seen, it stops; unseen, it closes.
- [x] **Chase, flee, and doors as a mechanic.** Caught looking too long and
  it comes at sprint speed over the navgraph, broken by line of sight and by
  doors — they already open for agents; let them slam for you.
- [x] **The writing on the walls.** Seeded canvas-texture decals from a
  written set (disturbing, and PG-13 — it is a school-building tool), placed
  by `decor.js`'s pack machinery pointed somewhere colder.
- [x] **Sound through walls, finally by ray.** Hearing it one corridor over
  is the whole game: a cast through sightline's segments prices the wall
  between you and a source, and daytime acoustics inherit the upgrade for
  free.
- [x] **Distance, routed.** The hunt's warmth and "how close is it really"
  share one routed answer over the navgraph instead of a straight line
  through walls.
- [x] **Flicker inside the budgets.** Failing fixtures, a downed sun, buzz
  and silence — all within the existing twelve-light and voice budgets; the
  mode costs atmosphere, not frame rate.

*Leans on:* `agents.js`, `sightline.js` (Phase 21 is the prerequisite),
`sound.js`, `decor.js`, `lift.js` (a lift at night is free horror), Phase 23
for delivery; *collides with:* the crowd — a haunt implies an empty
building, and the school day and the creature never share one — and the
tool's tone: off by default, invisible until asked for. *Save:* v12 — one
optional record, the cheap kind. *Model:* **Claude Fable 5** — chase and
hearing are navgraph and occlusion math; the writing set is the only line of
it any model could do.

*How it shipped:* two new pure modules — `haunt.js` (the record, a
five-stage machine `day → dismissal → dusk → company → flight` that is a
pure function of `(finds, elapsed, seed, intensity)`, the flicker as a
deterministic curve, the writings and their placement, the fake-crash curve,
the slam geometry, and the way out) and `creature.js` (a lean stepper, *not*
an agent — the crowd's fourteen hundred lines are timetable society, and the
creature's goal model is a sightline query; it imports `rng`, the navgraph's
routes, `moveWalker` and `sightClear` and does the rest with one switch).
The objective is the delivery mechanism: the export's star hunt is
`hunt.js` re-skinned (`opts.items`, `opts.indoors`), each find ratchets the
stage, the last flips the objective to *get out* — with every exterior door
but one locked ("The door appears to be locked. Find another way."), the
open one a seeded pick from the five pathing-farthest, so it lands across
the building. Caught is a fake crash — tear, static, one honest second of
error card, wake at the entrance, finds kept. Doors slam *behind the fleeing
player* (crossing a doorway mid-chase drives the leaf shut; a shut leaf
breaks pursuit and sight with one rule), so no new hotkey was spent.

*What fought back:* the flicker trap was real — `updateDynamicLights`
early-returns on `lampLevel`, so the seam multiplies *cached base
intensities after the budget* and never touches the level; the spill and
fixture glow ride the same curve or a corridor stays lit while its lights
die. The routed warmth's first cut charged a detour to the middle of the
destination room (the room node), and its second discovered that a corner
place's next-door test point was *outside the building* — both times the
routed answer was right and the fixture was lying. The exodus reuses the
drill with the klaxon deliberately unplugged (a dismissal is a bell), capped
at 75s with stragglers vanishing under the first blackout. The one scope
call against the plan: the haunt *runtime* lives only in the walk export —
the tool arms the record (one palette command, a native prompt, "· haunted"
on the export note) and never turns itself; playtesting is downloading the
export, which is one click and is the artefact that ships anyway. Headless
Chromium walked the whole arc from `file://` — crowd of 102 at day, empty at
dusk, creature lurking at company, one of two exits locked at flight — with
zero network requests and zero console errors, and the same seed twice is
the same night to the inch.

## Phase 25 — The point you meant *(shipped)*

**Every drawing tool in this editor guessed, and three of them guessed
wrong.**

The wall tool did not ask how long a wall was. You pointed at a room's
boundary and *the whole run between two of its corners* became a wall — so
the length was the polygon's, not yours, and walling eight feet of a
thirty-foot classroom side meant going and inserting two vertices by hand
with a different tool first. The floor brush laid one 4ft cell at a time,
which is the right gesture for an alcove and the wrong one for a classroom:
dragging a rectangle out cell by cell is the tool asking you to do its
arithmetic. And the drawing grid was 4ft whether the screen showed six
hundred feet of site or thirty feet of one room — a grey wash at one end, and
coarser than the thing being drawn at the other.

This is the first phase after arc four, and it is a *fix* rather than an
addition: nothing here is new capability, all of it is the tool no longer
guessing on your behalf.

Two of the backlog's own findings are closed here too. Its "a boundary
that bounds no room cannot be drawn" wanted a boundary belonging to the
*storey*; that is `floor.walls`. And selecting an elevator threw before it
could be described, moved or deleted, because `cutBox` returns null for the
one link that cuts no hole and two call sites read the null's `.x1` — which
is the whole of "there is no way to delete a lift".

- [x] **A wall is two points.** `wallrun.js` + `test/wallrun.test.mjs`. Click
  one end, click the other, exactly the way the overlay's measurement is
  taken and for the same reason (you zoom between the two clicks, and a drag
  cannot survive that). The run's far end becomes the next anchor, so a
  corridor is four clicks; Esc ends the run.
- [x] **Where the run lands is worked out, not assumed.** A stretch that lies
  along a room's boundary splits that ring at both ends and sets the covered
  piece — so the room stays bounded, the thickness probe still sees a room on
  each side, and a door still cuts into a ring segment. A stretch that lies
  along nothing becomes a **wall line** on `floor.walls`. One drawn run can be
  both. Drawing over an existing wall of the same kind absorbs it rather than
  stacking a second wall on top of the first.
- [x] **A drawing grid that follows the zoom.** `snapgrid.js` +
  `test/snapgrid.test.mjs`. A ladder of round pitches from half a foot to
  thirty-two, the finest that still leaves the view legible; the heavy line
  falls back onto the 4ft cell once the grid is finer than one, so the module
  the brush paints in stays countable. Both ends of every run land on an
  intersection, and a toggle (`S`) holds the run square to the grid — Shift
  for one free run, Alt to ignore the grid outright.
- [x] **The floor tool draws rectangles.** Drag a corner to a corner and every
  4ft cell inside is laid at once; `R` puts the brush back, and the eraser
  shares the switch, because it rubs out the same cells.
- [x] **Vertical links you can find.** The stairs panel lists every stair,
  ramp, lift and floor opening the storey can act on, lights the selected
  one, and gives select / rotate / nudge / delete a button each — through the
  same functions the pointer and the keyboard already called. An elevator is
  selectable from *either* level it serves, which is what `linkAt` always
  said and what `selected()` did not.
- [x] **A walkthrough that walks without Pointer Lock.** An iframe without
  `allow="pointer-lock"`, a browser that refuses, a dismissed permission —
  `lock()` reports none of it, and `update()`'s guard meant walk mode was not
  merely mouse-less but frozen: WASD did nothing either. Pointer Lock is
  still asked for first; when it does not arrive, the mouse steers by drag
  and WASD moves regardless.

*What fought back:* the free-standing wall wanted to be a room with a
two-point ring, which would have been one line in `shapes.js` and a branch in
every one of the forty modules that walk `shapesOf(floor)` treating each
shape as a room. A separate per-storey array is additive in the save file,
invisible to everything that counts rooms, and reaches the eight places that
actually care about *boundaries* — the renderer, the collider, the plan
sheet, the door leaves, the takeoff (through the plan), the eraser, the door
tool and the session log. Openings on a wall line are pinned to `seg: 0`
precisely so that every consumer that already filters a ring's openings by
segment index needed no new branch at all. *Save:* v12 still, additive —
and the first append that is per *storey* rather than design-wide: a level
with no free-standing wall writes no `walls` key, so every file written
before this build round-trips through it as the same bytes, for the
fifteenth time. *Model:* **Claude Fable 5** — two pure modules, a schema
append, and the collider contract.

## Phase 26 — Take it out again *(shipped)*

**Three sentences of feedback, and every one of them was about a thing the
build could already do and could not be asked to do.**

*"We need a way to delete placed walls, staircases, elevators, etc."* Every
one of those could be deleted, and each from inside the tool that placed it:
select it with the stairs tool and press Delete, select it with the furniture
tool and press Delete. The tool actually labelled **Erase** rubbed out floor
and nothing else — so a click on a staircase with the eraser selected did
precisely nothing, which is indistinguishable from a build with no way to
delete a staircase. That is the whole finding: a verb that exists but is not
where anybody looks for it is a verb that does not exist.

*"I'd like to be able to place doors on existing walls. Same with windows."*
The door tool has cut openings into free-standing walls since Phase 25 and
into room boundaries since Phase 1. What it could not do was be *hit*: its
grab tolerance was a constant 1.6 feet, which at the zoom that fits a school
on a screen is about two pixels of aim. And a click that landed on nothing
said nothing, so the tool's answer to a near miss was silence — which reads
as "this tool does not work", because from the chair it is the same thing.

*"Walking mode still does not respond to WASD movement and mouse controls."*
Measured, on a machine drawing this building with a software rasterizer:
three seconds of held W moved the camera **2.4 feet**. Walking speed is 12
ft/s, so it owed 36. The cause is two clamps that are individually reasonable
and jointly ruinous — the page's loop hands the walker `min(delta, 0.1)`, and
the walker refuses a step longer than 1.5ft — so a browser managing two
frames a second simulates a fifth of every second and one managing eight
simulates four fifths. Nothing is broken; the clock is. From a chair, a
building that creeps when you hold W is a keyboard that does not work.

- [x] **The eraser is a delete key.** One click with **Erase** removes
  whatever is under it, whichever tool put it there: a free-standing wall, a
  room's own boundary, a staircase, a ramp, an elevator, a plain floor
  opening, a piece of furniture, a whole free-drawn room. Dragging still rubs
  out floor by the rectangle, which is the gesture that was always right for
  the one thing you erase by the square foot — so the decision is made on the
  way *back up*: a press that travelled less than a cell is a click, and a
  click with something under it is a delete. The status line says what went.
- [x] **A grab tolerance that follows the zoom.** The door and eraser tools
  size their reach off the view height, the same way the polygon handles, the
  stair tool's grab box and the drawing grid already did — the old 1.6ft is
  the floor, so nothing got harder to hit close up. And a door click that
  lands on no wall now says so, and says what a door needs.
- [x] **A walker with its own clock.** `walkthrough.js` accumulates the
  frame's *real* elapsed time and spends it in fixed 1/60s physics steps,
  however many this frame can afford, bounded at half a second of catch-up so
  a tab that was hidden for a minute does not arrive through a wall. Movement
  is now proportional to wall-clock time at any frame rate, and collision got
  more honest for free: a step is never longer than a fifth of a foot.
- [x] **Every way into a walk is armed.** Walking used to be armed by exactly
  three things — a Pointer Lock that arrived, the 400ms probe that notices
  when one did not, and a touch — and when all three were missed, walk mode
  was *input-dead* with nothing on screen to say why. A movement key now arms
  the drag fallback itself, and so does a drag on the canvas. The arrow keys
  are the same four keys as WASD, because not everybody who opens a
  floor-plan tool has played a first-person game.
- [x] **A walk starts where you say.** Every walk began at the deepest point
  inside the storey's biggest room — a good guess and a bad rule, since the
  biggest room in a school is the gym and "show me the entrance" then costs
  you the length of the building at 12 ft/s, every time. A storey can now
  carry a start point: pick a room out of the walk overlay's list, or stand
  somewhere and press **📍 Start here next time**. Changing it moves you
  there straight away rather than at the next walk.

*What fought back:* the eraser's press-or-drag ambiguity. Claiming the
*press* for the object under it is one line and makes the rectangle eraser
unusable along any edge of a room, because rubbing out a block of floor that
starts on a wall is a thing people do constantly. Deferring to the pointer-up
costs a held candidate and a second `pushUndo` — which is free, because
`commit()` diffs and an empty diff pushes nothing. *Save:* v12 still,
additive, and the sixteenth application of the one rule — a storey nobody has
chosen a start point on writes no `spawn` key, so every file written before
this build round-trips through it as the same bytes. *Tests:*
`test/spawn.test.mjs` for the record, and five new checks in
`test/tools/run.mjs` for the gestures — the erase, the door, the window, the
pace of a held W and the start point are all things only a real pointer and a
real keyboard can prove.

### What this arc leaves for a fifth

Arc four deliberately turns outward, toward the person handed the result.
What the backlog still says underneath it is unchanged, and it is the honest
start of a fifth arc rather than this one: a pure entry point to the report
pipeline so the specification sheet can join the visual harness ("a drawing
is a set of sheets, not a picture"); a way to ask what changed between two
versions of a design ("a design has a history somebody else can read"); the
readers that answer with a number where they should answer with a range
("the model knows what it does not know"); and the session hardening —
storey ids, snapshot-only assets, no retry, local-wins undo — that a shipped
relay made real ("two people is not two windows").
