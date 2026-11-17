# Merchant: the art list

Version 2, 2026-11-17. For a Claude Code session on Devon's Windows machine,
which has Blender and a real GPU. This file is the whole brief: the session
needs nothing else. Version 2 applies the corrections the game's research
made, which Devon also has as a numbered list of requests.

**How to start a session:** "Read ART.md and do batch 1." Then batch 2, 3, 4.
Batch 1 is a test of the look. Stop after it and show Devon the pictures
before going on.

**What comes back:** the folder described in section 5, dropped into the
Huginn Inbox as `merchant-art/`. The orchestrator on Huginn picks it up from
there.

The history in this file is a careful draft, not yet checked against sources.
The game's research milestone will check it and may ask for a rerender. That
is why every picture must come from a script that gives the same picture
twice: a correction should cost one command.

---

## 1. The game, in four lines

Merchant is a browser game for 7th graders. The player runs a trading house in
Cairo between 1324 and 1347 and never leaves the desk: agents go out along the
Red Sea, the Mediterranean, the Sahara and the road east, and the work arrives
as letters. The pictures are still images that sit behind the game's own text
and buttons. They should look like photographs of a real place in soft light,
calm enough to read text over.

## 2. Rules for every picture

### 2.1 The look

- **Realistic, rendered with Cycles on the GPU.** Real materials, real light,
  depth of field where a lens would give it. Not low-poly, not stylised.
- **Two kinds of picture only.** Close still lifes on a table, and wide views
  from far off at low sun with haze in the air. Nothing at middle distance.
- **No faces. None, anywhere, at any size.** No person is ever close. A person
  may appear only as a small, hooded or turbaned figure seen from behind or
  against the light, no taller than 5% of the picture's height, with no face
  geometry modelled at all. The same limit holds for animals: camels, horses
  and mules are distant shapes or silhouettes, never close.
- **No readable writing in any script.** Paper carries faint, soft, illegible
  lines where ink would be. The game puts its own words on top. No signs, no
  inscriptions, no flags with devices, no numerals.
- **Calm lower third.** The game often lays a text panel over the bottom 30%
  of a wide view. Keep that band darker and plain: ground in shadow, water,
  sand. Keep the subject in the middle half of the width.
- **One family.** Every picture uses the shared setup in `common.py`
  (2.3): the same colour transform, the same sky and sun presets, the same
  haze, the same lenses, the same materials. A picture that needs something
  new adds it to `common.py`, so the next one can use it.
- **Nothing later than 1350 and nothing from the Americas.** Each entry lists
  the traps for its scene. The general ones: no gunpowder weapons, no
  three-masted European ships (A13's Chinese junk is the one big ship allowed
  more masts), no glass shop windows, no printed matter, no clocks, no
  maize, tomatoes, potatoes, chillies, tobacco or cacao, no coffee.

### 2.2 The machine and the commands

- Check `blender --version` first. Use the 5.2 LTS install if it is there
  (the Steam copy on this machine has been 5.2). Write the version you used at
  the top of `common.py` as the pinned version and make every script refuse to
  run on a different major.minor.
- Headless only, never through the Blender window:
  `blender -b --factory-startup -P scripts/<script>.py -- <options>`
- `--factory-startup` clears the GPU setting, so `common.py` must turn the GPU
  on itself: set the Cycles compute device type (OptiX if present, else CUDA
  or HIP), refresh and enable the devices, set the scene to GPU. If no GPU is
  found, print a loud warning and say so in the report.
- Every script takes `-- --preview` (quarter size, 64 samples) and
  `-- --final`.
- Fixed seeds everywhere. Running a script twice must give the same picture.
- Paths built with `os.path.join` from the script's own location. No absolute
  paths, no drive letters.

### 2.3 `common.py` and the kits (build these first)

`scripts/common.py` holds, at least:

- version check, argument parsing, an empty-scene reset, one seeded random
  source;
- Cycles setup: GPU on, adaptive sampling, final 512 samples with the
  OpenImageDenoise denoiser, preview 64;
- colour: the AgX view transform with one contrast look chosen in batch 1 and
  then never changed;
- sky and sun presets by name: `dawn`, `day`, `late`, `dusk`, `moon`,
  `overcast`, `storm`, each a sky plus a sun angle and strength, either
  Blender's own sky texture or a CC0 sky image;
- `haze(density, colour)`: a world or box volume for distance haze;
- lenses by name: `wide` 24 mm, `normal` 40 mm, `long` 85 mm, `table` 50 mm
  with a shallow depth of field;
- a materials library by name: walnut, plain wood, weathered ship timber,
  brass, copper, gold, silver, paper, leather, linen, wool, silk, sailcloth,
  rope, glazed ceramic, blown glass, limestone, striped stone, mud brick,
  lime plaster, sand, snow, sea water, harbour water;
- `save_still(name)`: writes the master PNG and the shipped WebP (2.4);
- `save_cutout(name, size)`: the same for pictures with transparency.

Kits, each a module the scenes import, so a thing is modelled once:

- `kit_ships.py`: Nile boat, Red Sea and Indian Ocean dhow, Mediterranean
  galley, Mediterranean round ship, a Chinese junk for the far distance;
- `kit_arch.py`: walls, towers, pointed arches, arcades, domes, a Mamluk
  minaret, flat-roofed houses, wooden lattice window screens;
- `kit_terrain.py`: dunes, rocky desert, mountains, coast, sea surface;
- `kit_props.py`: bales, sacks, baskets, storage jars, chests, rope coils,
  balance scales, oil lamps, tents;
- `kit_figures.py`: one cloaked human figure, a one-humped camel, a
  two-humped camel, a mule. Low detail, built only to be seen far off. Give
  it a guard that refuses to place one so that it would be taller than 5% of
  the frame.

### 2.4 Sizes and formats

| Kind | Master (stays on Windows) | Shipped (goes in `out/`) |
|---|---|---|
| Still | PNG 2560 x 1440 | WebP 1920 x 1080, 400 KB or less |
| Cutout: good | PNG 1536 x 1536 with alpha | WebP 768 x 768 with alpha, 120 KB or less |
| Cutout: token | PNG 768 x 768 with alpha | WebP 384 x 384 with alpha, 60 KB or less |
| Cutout: object | PNG at twice the shipped size | WebP with alpha at the size its entry gives, 150 KB or less |

- Make the shipped file from the master inside Blender (its image API or the
  compositor), so no other program is needed.
- For a still, start at WebP quality 82 and step down to no lower than 72 to
  meet the size. If it still does not fit, say so in the report; do not go
  lower.
- Cutouts render with a transparent film and a shadow catcher, so each carries
  its own soft contact shadow.

### 2.5 Inputs from outside

Free-licence inputs are allowed and welcome where they make a picture more
real than a procedural material would:

- **CC0 only.** Poly Haven and ambientCG are the two libraries to use for
  textures, sky images and small prop models. For the map (A03), Natural Earth
  coastlines and a NASA or NOAA public-domain elevation grid.
- Nothing with any other licence. No "free for personal use", no attribution
  licences, no AI-generated images.
- Record every input in `inputs.json`: its name, the library, the licence,
  the file name, and which pictures use it.
- Downloaded files stay on Windows in `inputs/`. They are not delivered.

### 2.6 How to work on one picture

1. Read its entry. Build or reuse what it needs.
2. Render `--preview`. **Open the preview and look at it.**
3. Check it against the entry's "Check" list and against 2.1. Fix what fails.
4. At most four rounds of preview and fix. If it still fails after four, stop
   on that picture, write what is wrong in its report, and move on.
5. Render `--final`. Look at the final too.
6. Write `reports/<id>.md`: what you built, what you could not get right, any
   detail of history you were unsure of, every outside input, and the render
   time.

## 3. Batches

| Batch | Pictures | Then |
|---|---|---|
| 1. The look test | A00, A01, A03, the caravan token from A04, pepper and silk from A15 | **Stop. Show Devon.** Deliver. |
| 2. The table | A02, the rest of A04, the rest of A15, all of A16 | Deliver |
| 3. The places | A05 to A14 | Deliver |
| 4. Events and title | A17, A18 | Deliver |

## 4. The pictures

Each entry: the file, what the game uses it for, the picture, what is in it,
what must not be, how to build it, and what to check.

### A00. Look test

- **File:** `look-test.webp` (still).
- **Use:** not in the game. It proves `common.py`.
- **Picture:** a walnut table top with one of each material from the library
  as a small swatch or object (a brass bowl, a folded piece of each cloth, a
  sheet of paper, a glass bottle, a glazed bowl, a block of each stone), under
  the `day` preset through a window, then the same under `dusk`.
- **Check:** brass looks like brass and not yellow plastic; cloth shows weave;
  paper is not pure white; glass refracts; shadows are soft; nothing is blown
  out; the picture reads as a photograph. Fix the materials here, not later.

### A01. The desk by day

- **File:** `desk-day.webp` (still).
- **Use:** the main screen. The player looks at this more than at anything
  else. The game lays letters and cards over the middle of it.
- **Picture:** a merchant's low writing table seen from above and a little
  back, the camera tilted about 60 degrees down, `table` lens. Morning light
  comes from a window at the top of the frame, through a wooden lattice
  screen, and falls across the table as a pattern of small soft-edged shapes.
  Warm, quiet, dust in the light.
- **In it:** a low table of dark wood with simple geometric inlay at its
  border, standing on a woven mat or carpet whose edge shows. Around the
  **edges** of the table only: a bound paper ledger lying open at the left; a
  brass balance scale with two pans and a row of small weights at the top
  left; a brass inkwell and two reed pens; a small stack of gold coins and a
  larger stack of silver; a few folded letters tied with thread at the right;
  a glazed ceramic oil lamp, unlit, at the top right; a string of prayer beads
  or a small brass bowl. At the very top, a strip of the lattice window with
  bright sky behind it. The brass inkwell and the coins carry no script: leave
  the bands plain or worn so no letter can be read.
- **Must be empty:** the middle of the table, at least 55% of the frame's
  width and 60% of its height, is bare wood with light on it. That is where
  the game puts its cards.
- **Not in it:** a European desk with drawers, a chair, parchment scrolls with
  rollers, a feather quill (pens here are cut reeds), wax seals with ribbons,
  a candle in a holder, a globe, a compass, an hourglass, books with printed
  spines, any readable writing.
- **Build:** `scripts/a01_desk.py`. The scene is reused by A02 with only the
  light changed, so take the light preset as an option.
- **Check:** the middle is clear; the objects at the edges are sharp enough to
  recognise and the far edge falls softly out of focus; the lattice pattern
  reads on the wood; the wood has grain and wear; coins are not perfect discs.

### A02. The desk at dusk and at night

- **Files:** `desk-dusk.webp`, `desk-night.webp` (stills).
- **Use:** the same screen in autumn and winter turns and in the last act.
- **Picture:** A01's scene and camera exactly, object for object. Dusk: low
  orange light, long lattice shadows, the room dimming. Night: the oil lamp
  lit, a small warm pool of light with deep shadow beyond it, a little cold
  moonlight on the window strip.
- **Check:** laid over A01, nothing has moved. At night the middle of the
  table is still light enough to read dark text on a pale card.

### A03. The map table

- **Files:** `map-cairo.webp` (still), `map-cairo-geo.json`.
- **Use:** the screen where the player plans routes and watches expeditions
  move. The game draws its own place names, routes and markers on top, and
  places the A04 tokens on it.
- **Picture:** a relief model of the lands from West Africa to India, as if
  carved from wood and plaster and painted, lying on a large table and lit by
  low window light from the upper left so the mountains cast real shadows.
  The camera looks down at about 70 degrees, `normal` lens, the whole model in
  frame with a border of table around it (thicker above and below, see Extent). Land in muted earth colours
  that follow the real ground (pale sand for desert, dull green for the Nile
  valley, the Mediterranean shores and the Indian coast, grey-brown for
  mountains with a little white on the highest). Sea as dark blue-green glass
  or enamel with a soft shine. The Nile, the Niger, the Tigris and Euphrates
  as fine inlaid lines.
- **Extent:** longitude 10 west to 80 east, latitude 5 north to 48 north, in a
  plain equirectangular layout scaled for latitude 27. That comes out at
  1.865:1, wider than 16:9, so at 1920 x 1080 the table border above and below
  the model is thicker than at the sides. Make it as thick as needed on those
  two sides; the lower third must stay plain.
- **Real geography:** build the coast from Natural Earth and the relief from a
  public-domain elevation grid, with heights exaggerated enough to read (start
  at 15 times). Do not draw coasts by hand.
- **Not in it:** any place name, border, route line, marker, pin, compass
  rose, sea monster or decorative cartouche. The game adds what it needs.
- **The JSON:** `map-cairo-geo.json` holds the picture's size; the pixel
  position in the shipped picture of every whole-degree crossing of latitude
  and longitude inside the extent, taken on the model's surface through the
  render camera; and the pixel position of each stop below. With the grid the
  game can place any later stop without a rerender.

| Stop | Lat | Lon | | Stop | Lat | Lon |
|---|---|---|---|---|---|---|
| Cairo | 30.04 | 31.24 | | Aden | 12.79 | 45.03 |
| Alexandria | 31.20 | 29.92 | | Calicut | 11.25 | 75.78 |
| Famagusta | 35.12 | 33.95 | | Hormuz (the island city of Jarun) | 27.07 | 56.46 |
| Venice | 45.44 | 12.33 | | Damascus | 33.51 | 36.29 |
| Constantinople | 41.01 | 28.98 | | Aleppo | 36.20 | 37.16 |
| Tunis | 36.80 | 10.18 | | Tabriz | 38.08 | 46.29 |
| Qus | 25.92 | 32.76 | | Samarkand | 39.65 | 66.96 |
| Quseir | 26.10 | 34.28 | | Tuat | 27.87 | -0.29 |
| Aydhab | 22.33 | 36.49 | | Walata | 17.30 | -7.03 |
| Jeddah | 21.49 | 39.19 | | Gao | 16.27 | -0.04 |

  These positions are approximate and the list will change. That is expected.

- **Build:** `scripts/a03_map.py`.
- **Check:** Italy, the Nile delta, the Red Sea, Arabia and India are
  recognisable at a glance; the relief casts shadows; the sea is calm enough
  to read text over; plot the stops from the JSON onto the shipped picture as
  red dots in a scratch copy and confirm each lands where it should (Cairo at
  the head of the delta, Venice at the top of the Adriatic, Aden at the mouth
  of the Red Sea). Deliver that scratch copy in `previews/`.

### A04. Tokens

- **Files:** `token-caravan.webp`, `token-dhow.webp`, `token-galley.webp`,
  `token-nileboat.webp`, `token-mules.webp` (cutout: token).
- **Use:** playing pieces the game moves across the map.
- **Picture:** small carved playing pieces, as if made by a craftsman for this
  table: dark wood with brass details, a little worn at the edges, each on a
  low round base. A string of three one-humped camels; a dhow with a single
  slanted sail; a galley with oars; a Nile boat with one tall slanted sail; a
  pair of laden mules. Carved simply, like good chess pieces, not miniature
  models.
- **Camera and light:** the same angle and the same light direction as A03, so
  a token laid on the map looks as if it stands there. The contact shadow
  falls the way the mountains' shadows fall.
- **Check:** each reads at 64 pixels across; laid on `map-cairo.webp` in a
  scratch composite it looks like it belongs.

### A05. Cairo, the gate at dawn

- **File:** `cairo-gate-dawn.webp` (still).
- **Use:** an expedition leaves.
- **Picture:** from outside the walls, well back and low, `long` lens, `dawn`.
  A stone city gate between two square towers in a short stretch of wall (the
  wall is not a long unbroken ring in this century: show short stretches of it,
  with houses spilling beyond), the first sun on the upper stone, mist and dust
  near the ground. In front of it, far off and
  small, a caravan forming: kneeling camels as dark shapes, bales on the
  ground, a few cloaked figures. Behind the wall, flat roofs, a few domes and
  two or three minarets against the sky.
- **In it:** pale limestone walls of large blocks. Square gate towers with a
  round-headed arch between them (model on Bab al-Nasr: square towers, a
  semicircular arch. Do not use Bab al-Futuh's round towers with the square
  towers). Minarets of the Mamluk kind: a square base, an octagonal middle
  storey, then an open pavilion with a bulb or ribbed helmet (either crown is
  right), with balconies between the stages.
- **Not in it:** the pyramids (they are not in this view); thin pencil-shaped
  minarets with pointed cone tops (two centuries later); a hilltop mosque with
  large grey domes (five centuries later); twin minarets standing on top of a
  gate (a century later); palm-lined boulevards.
- **Build:** `scripts/a05_cairo_gate.py`, with `kit_arch` and `kit_figures`.
- **Check:** the figures and camels are tiny and faceless; the lower third is
  dim ground mist; the gate is the subject.

### A06. Alexandria, the harbour

- **File:** `alexandria-harbour.webp` (still).
- **Use:** Mediterranean voyages.
- **Picture:** from a quay looking out across a wide curved harbour, `wide`
  lens, `late`. Calm water catching the sun. Ships at anchor and at the quay.
  On the far point that closes the harbour, the broken stump of a very large
  ancient tower.
- **In it:** two or three round-hulled merchant ships with one or two masts,
  sails furled; one long low galley; small boats. The quay of worn stone with
  rope coils, storage jars, sacks and bales. The ruined lighthouse as it stood
  from 1324 to 1347: the great square lower stage still standing, with an
  entrance ramp and one face of the tower ruined, the upper stages fallen
  (wrecked by earthquakes from 1303 on).
- **Not in it:** the lighthouse whole; a stone fort on that point (built in
  1477); ships with three masts, castles fore and aft, or gun ports; barrels
  in great numbers (jars and sacks are the common containers here); cranes.
- **Build:** `scripts/a06_alexandria.py`. Take dressing options, because A17's
  empty harbour reuses this scene.
- **Check:** the ruin reads as a ruin; the water is believable; no crew is
  close.

### A07. A Red Sea port

- **File:** `redsea-port.webp` (still).
- **Use:** the Red Sea and the voyage to India.
- **Picture:** a bare desert shore, `late`, `wide` lens. A bare coast with a
  large trading town of low houses of coral stone and shelters of matting, a
  water reservoir, dhows drawn up and at anchor in very clear green-blue
  shallow water over reef. Bare brown hills behind. Heat haze.
- **In it:** dhows with hulls of planks sewn together with cord (no nails:
  show the stitched seams where a hull is near), pointed at both ends, one
  mast, one slanted sail, with a square sail as a second option. Camels as
  distant shapes bringing loads down to the beach. Bales and sacks under
  matting.
- **Not in it:** a stone harbour wall, a lighthouse, palm groves,
  square-sterned ships.
- **Unsure:** the exact rig of these ships in the 1300s is argued over. Build
  the sail as one option that can be swapped, and say which you used.
- **Build:** `scripts/a07_redsea.py`.
- **Check:** it looks hot, remote and real; the water is the brightest colour.

### A08. The Sahara

- **File:** `sahara-dunes.webp` (still).
- **Use:** the road west.
- **Picture:** great dunes at `late` sun, `long` lens, long blue shadows in
  the hollows, wind lifting a thread of sand from the crests. Along one
  distant crest, a long line of camels and walkers in silhouette.
- **In it:** one-humped camels only. Some carry rock salt: grey-white slabs
  roped flat, one on each side.
- **Not in it:** two-humped camels, a palm oasis, vehicles' tracks, people
  near the camera.
- **Build:** `scripts/a08_sahara.py`. Make the dune field with `kit_terrain`
  so A17's sandstorm can reuse it.
- **Check:** the caravan is a thin line of tiny shapes; ripples show on the
  near sand; the lower third is a plain shadowed slope.

### A09. A mountain pass in snow

- **File:** `mountain-pass.webp` (still).
- **Use:** the road east in winter, and a closed route.
- **Picture:** a high pass between rock walls, `overcast` turning to snow,
  `normal` lens. A narrow track climbing to a notch in the ridge. Deep snow, a
  stone cairn, a small rough stone shelter with smoke. Far up the track, a few
  loaded animals and walkers as small dark shapes.
- **In it:** the animals here are mostly one-humped camels and mules, with a
  few two-humped (this is the Asian road, not the Sahara).
- **Not in it:** a paved road, poles, pine forest in neat rows, a castle.
- **Build:** `scripts/a09_pass.py`.
- **Check:** it looks cold and hard to cross; falling snow softens the
  distance; the figures are tiny.

### A10. A caravanserai at night

- **File:** `caravanserai-night.webp` (still).
- **Use:** letters written from the road.
- **Picture:** the inner courtyard of a roadside inn for caravans, from a
  corner of its upper gallery looking down and across, `wide` lens, `moon`. A
  square court ringed by an arcade of pointed arches on two floors, one great
  gate, a well or basin in the middle. Warm oil lamps in the arches against
  cold moonlight on the stone. Camels kneeling in the court as dark shapes,
  bales stacked, a few cloaked figures by a small fire, seen from behind and
  far below.
- **In it:** stone in alternating light and dark courses around the gate.
  Heavy wooden gate leaves with iron studs.
- **Not in it:** glass lanterns, chimneys, signs, tables and chairs.
- **Build:** `scripts/a10_caravanserai.py`.
- **Check:** the warm and cold light both read; nothing in the court is near
  enough to show a face.

### A11. A town on the Niger

- **File:** `sahel-town.webp` (still).
- **Use:** the far end of the Sahara road.
- **Picture:** a town of mud brick on a flat plain beside a wide slow river,
  `late`, `long` lens, dust in gold light. Smooth earthen walls with rounded
  edges, flat roofs, and one larger building, a plain flat-roofed mud mosque,
  with sticks of scaffolding left in the walls and at most a low squared tower;
  no projecting rows of beams. Model the town on Gao, not on Timbuktu. Long
  narrow boats on the river, each hollowed out of a single piece of wood. A few
  thorn trees, and one great thick-trunked tree only if it can be done in the
  haze.
- **Not in it:** an exact copy of any famous building (the well-known great
  mosques of the region in their present form are later rebuildings); tin
  roofs; palm-thatch huts in the "jungle village" manner.
- **Build:** `scripts/a11_sahel.py`.
- **Check:** the walls look like hand-smoothed earth, not concrete; it reads
  as a rich, large town, not a village.

### A12. A covered market

- **File:** `bazaar.webp` (still).
- **Use:** Damascus, Aleppo and Tabriz.
- **Picture:** inside a long market street roofed with stone or brick vaults,
  empty in the early morning, `normal` lens. Shafts of sun come down through
  openings in the roof into dusty air. Stalls along both sides, raised a step,
  their goods laid out: bolts of cloth, brass and copper vessels, sacks of
  spice with the tops rolled back, rope, jars. At the far end, small in the
  light, one or two cloaked figures from behind.
- **Not in it:** any food plant from the Americas (the red spice heaps people
  expect are chillies and paprika: do not show them; use black pepper, pale
  ginger, brown cinnamon, yellow turmeric, dried rose buds); coffee pots and
  cups; hanging glass lamps in dozens; painted tile walls in white, blue and
  red flower patterns (later); signboards.
- **Build:** `scripts/a12_bazaar.py`.
- **Check:** the light shafts are the picture; the goods are recognisable; no
  one is near.

### A13. A harbour in the monsoon

- **File:** `malabar-harbour.webp` (still).
- **Use:** Calicut, and the wind that sets the calendar.
- **Picture:** a green tropical shore under a huge bank of monsoon cloud,
  `storm` with one break of light on the water, `wide` lens. Rain falling in
  grey curtains out to sea. Coconut palms bent in the wind. A beach with
  sewn-plank boats hauled up above the surf, wooden warehouses with steep
  thatched or tiled roofs, sacks under cover. Far out at anchor, one very
  large ship of a different kind: a Chinese junk with sails of plaited bamboo,
  like mats, on three to several masts.
- **Not in it:** a stone fort or a church (both come with the Portuguese
  after 1498); European ships; a pier.
- **Build:** `scripts/a13_malabar.py`.
- **Check:** it looks wet; the junk is small and far but clearly not a dhow.

### A14. A Venetian quay

- **File:** `venice-quay.webp` (still).
- **Use:** Venice, and what the Italians bring.
- **Picture:** the water's edge of a trading city built on a lagoon, `dawn`
  with mist, `normal` lens. Brick warehouses with rows of round and pointed
  arches at the water, wooden mooring poles, stone steps down into green
  water. A galley and a round ship moored, small flat boats, bales of wool
  cloth and barrels on the quay.
- **In it:** the galley is a Flanders-type or Romania-type trade galley with
  two masts; it is not an Alexandria convoy ship.
- **Not in it:** any famous landmark at all (most of the well-known skyline is
  later: the stone arched bridge (the Rialto stone bridge is 1588 to 1591;
  a wooden Rialto bridge did stand then, so a wooden bridge is allowed), the
  great domed church at the mouth of the canal, the pointed spire on the bell
  tower); black gondolas with comb-shaped iron prows (1562 to 1609 and later;
  sources differ); glass windows in large panes.
- **Build:** `scripts/a14_venice.py`.
- **Check:** it reads as a northern, misty, brick city, unlike every other
  picture in the set.

### A15. The goods

- **Files (cutout: good):** `good-pepper.webp`, `good-silk.webp`,
  `good-gold.webp`, `good-salt.webp`, `good-porcelain.webp`,
  `good-glass.webp`, `good-linen.webp`, `good-sugar.webp`,
  `good-incense.webp`, `good-copper.webp`, `good-wool.webp`.
- **Use:** cargo lists, price tables, the notebook. Shown as small as 64
  pixels and as large as 400.
- **Picture:** each good alone, as a small still life, on a transparent
  ground with a soft shadow. One rig for all eleven: the same camera (about
  35 degrees down, `table` lens), the same soft window light from the upper
  left, the same scale of subject in frame.

| Good | What to show |
|---|---|
| Pepper | A small cloth sack with its top rolled down, or a basket (the *sporta*), full of black peppercorns, a few spilled |
| Silk | Two bolts of smooth, shining cloth, one deep red, one gold-yellow, an end unrolled |
| Gold | A few gold coins and a small open leather pouch of gold dust; no script on the coins or pouch: leave them plain or worn so no letter can be read |
| Salt | A grey-white slab of rock salt the size of a paving stone, roped |
| Porcelain | A celadon bowl and small jar, pale grey-green, thick even glaze, no painted pattern |
| Glass | A blown bottle and a beaker, slightly green or amber, a little uneven |
| Linen | Folded lengths of off-white cloth, matt, a visible weave |
| Sugar | Two tall white cones of hard sugar, one chipped |
| Incense | A bowl of whitish resin lumps, a few yellowed, beside a small brass burner |
| Copper | A stack of rough red-brown bars |
| Wool cloth | A heavy piece of dark blue cloth, thick and matt |

- **Not in it:** blue-and-white painted porcelain, sugar cubes, glass that is
  perfectly clear and even, chillies anywhere near the pepper.
- **Build:** `scripts/a15_goods.py`, one good per option.
- **Check:** each is recognisable at 64 pixels; silk, linen and wool differ
  clearly in shine and weight; the eleven look like one set.

### A16. Objects

- **Files (cutout: object, width x height in pixels):** `letter-sealed.webp`
  (600 x 300), `letter-open.webp` (900 x 1200), `sheet-blank.webp`
  (1200 x 1600), `contract.webp` (600 x 1200), `ledger-open.webp`
  (1600 x 1000), `coins-few.webp` (400 x 400), `coins-some.webp` (400 x 400),
  `coins-many.webp` (400 x 400), `seal-1.webp` to `seal-8.webp` (256 x 256).
- **Use:** the game's cards are these pieces of paper lying on the desk. The
  seals stand for the eight agents.
- **Picture:** each object seen straight down, lit as on A01's desk by day, on
  a transparent ground with a soft shadow.
  - Sealed letter: a sheet folded into a narrow packet, tied with thread; the
    seal is optional. The outer face carries an address written upside down in
    a few illegible lines.
  - Open letter: the same sheet unfolded, fold lines showing, the upper two
    thirds covered in faint illegible ink lines, the rest empty.
  - Blank sheet: handmade paper, slightly uneven in colour, fold lines, no
    ink. The game writes on this, so keep it pale and even.
  - Contract: a longer sheet, faint lines, and at the foot four short soft
    strokes of ink in a row, each unreadable, as witnesses' signatures.
  - Ledger: a bound paper book open flat, ruled faintly, mostly empty.
  - Coins: gold and silver together, in three amounts. No script: leave the
    bands plain or worn so no letter can be read.
  - Seals: eight stamped marks in dark ink or pressed clay, each a different
    simple device made of geometry or plant forms (a star of eight points, a
    knot, a palm leaf, a ring of dots, a crescent of leaves, a lozenge, a
    wheel, a rosette). No letters, no animals, no faces.
- **Not in it:** red wax seals with ribbons, parchment with curled corners and
  burnt edges, feather quills.
- **Build:** `scripts/a16_objects.py`.
- **Check:** dark text set over `sheet-blank.webp` is easy to read; the eight
  seals can be told apart at 48 pixels.

### A17. Event plates

All stills.

- **`storm-sea.webp`. A ship in a storm.** A single round ship or galley,
  small in the frame, climbing a great grey swell under a black sky, one torn
  sail, spray. `storm`, `long` lens. No crew visible. Check: the sea has
  weight; the ship is in danger but afloat.
- **`sandstorm.webp`. A sandstorm.** A08's dune field with a brown wall of
  dust hundreds of metres high rolling in from one side, the sun a dull disc
  through it, and a caravan halted, the camels kneeling as small dark shapes.
  Check: the wall has scale.
- **`toll-gate.webp`. A toll on the road.** A dry valley road closed by a
  small stone fort and a wooden bar across the way, a plain banner with no
  device, a few distant guards as cloaked shapes on the wall. `day`, harsh
  light. Check: it reads as "you must pay to pass".
- **`procession.webp`. The king of Mali camps by the pyramids, 1324.** From a
  rise, `late`, `long` lens, dust in gold light: a very large camp of tents on
  the desert edge, with hundreds of camels and people as tiny shapes, and
  beyond it the three great pyramids. Here and there a glint of gold. The
  pyramids keep most of their smooth outer casing, loosened by the 1303
  earthquake (the casing was stripped later, said to be in 1356). The Great
  Sphinx is left out: its head would be a face, and 2.1 allows none at any
  size. Check: the camp looks vast; no figure is more than a few pixels tall.
- **`harbour-empty.webp`. The harbour in autumn, after the news.** A06's scene and camera
  under `overcast`: grey flat light, the quay bare, no boats moving, no goods,
  and one ship alone at anchor far out with its sails furled. Nothing else.
  Check: beside A06 the difference is felt at once; nothing gruesome is shown.

### A18. Title

- **Files:** `title.webp` (still), `title-wide.webp` (1200 x 630, 250 KB or
  less).
- **Use:** the title screen and the card that shows when the game is shared.
- **Picture:** at the window of the merchant's room at `dawn`, looking out
  through the open lattice screen over the roofs, domes and minarets of Cairo
  to the river and a pale sky. On the sill in the near foreground, in soft
  focus, a sealed letter and a small brass balance. The upper left third of
  the frame is plain sky, where the game sets its title.
- **Not in it:** the traps of A05.
- **Check:** the sky third is empty and even; the city is hazed and far; the
  two objects say what the game is.

## 5. What to deliver

One folder, `merchant-art/`, dropped into the Huginn Inbox after each batch
(add to it; do not rename it):

```
merchant-art/
  ART.md              this file
  scripts/            common.py, the kits, one script per picture
  out/                every shipped .webp, and map-cairo-geo.json
  previews/           the map check with red dots, the token composite
  reports/            one .md per picture id, and batch-N.md
  inputs.json         every outside input, with its licence
```

Not delivered, kept on Windows: `masters/` and `inputs/`.

`reports/batch-N.md` lists every file the batch made, its pixel size and its
size in bytes, which pictures failed their check and why, and the Blender
version and GPU used.

## 6. If something in this file is wrong

If an entry asks for something that cannot be built, contradicts another
entry, or looks wrong about the history, do the nearest sensible thing, finish
the picture, and say exactly what you changed and why in its report. Do not
stop the batch for it. The one thing never to trade away is 2.1: no faces, no
readable writing, nothing after 1350.
