# Asset wishlist: what to generate with Nano Banana Pro and Veo

Written 2026-10-03 from a read of the repo. No code was changed. This file is a
live URL once it merges (the repo root is the site), so delete it or move it
into `HISTORY.md` once the work is done.

**The short version.** 76 stills across 8 sets and 1 video clip. The site's own
imagery (the board, the tavern, the previews, the share cards, every sprite
sheet) is already produced by a Blender pipeline with validators in CI, and
generated art would make it worse, not better. The gap is somewhere else: the
text-heavy games have empty art slots that were built and never filled.
Torchbearer has a `.scene-art` CSS rule nothing emits. Daredevil has a
`#panel-art` box that shows a gradient across 232 scene uses. Characters has
nine medallions holding initials. That is where the credits go.

Sizes below are export targets after compression, not generation sizes.
Generate at 2K and downscale.

---

## 1. Style anchor

The shell is a guild noticeboard in a tavern at night: wood `#241a10`,
parchment `#F1E6C8`, brass `#B08D3E`, wax red `#7E2A20`, one warm light and
deep brown-black shadow, set in Grenze Gotisch and Alegreya. The share cards
are low-poly dioramas on a walnut plinth with a brass band against a
`#2e2114` to `#0d0904` gradient. The tone is dry and specific: "Somebody took
this one and never brought it back. The barkeep says that happens." Each game
then keeps its own palette and its own fonts, by rule (#17), so there is no
single site look to match beyond warm light, limited colour and plain shapes.
The art has to read as illustration, not as a photo and not as a 3D render,
or it will fight the real renders sitting next to it.

**House prefix. Paste first in every prompt unless the item says to skip it:**

```
Flat gouache and ink illustration on warm toned paper. Limited palette of five
or six colours. One warm light source, deep brown-black shadows, soft falloff.
Visible brush texture and paper grain. Simple strong shapes, little fine
detail, nothing photographic, nothing 3D rendered. No text, no lettering, no
logos, no signatures, no watermark, no border, no frame.
```

**Then one palette line per project** (given with each item), then the subject.

**Keeping a set consistent.** Generate the first image of a set until it is
right, then attach it as a style reference for every other image in that set
and say "same medium, palette, line weight and lighting as the reference".
Do a whole set in one sitting. Do not mix sets in one chat.

**Portrait convention, all portrait sets:** head and shoulders, three-quarter
view, eyes level at the upper third, lit from the upper left, flat single
colour background, subject fills 80% of the frame, nothing cropped at the top
of the head.

---

## 2. Nano Banana Pro list, ranked by impact per effort

### N1. Torchbearer scene plates (15 images)

**What and where.** A wide plate above the scene title in
`Projects/torchbearer.html`. The `.scene-art` rule is at line 267 and has been
waiting since the CSS was written (`torchbearer/WISHLIST.md:965`). The scene
template is at lines 2543 to 2552. One plate per location, not per scene:
68 scenes share 15 places.

**Palette line:**
`Palette: soot black #17130E, leather brown #2D2416, parchment #EADCB8, brass #C79A4B, ember red #A5402D, verdigris #5E9C8F.`

**Prompt template:**

```
[house prefix] [palette line] Wide establishing shot, no figures closer than
the middle distance, horizon in the upper third, the lower third dark and
quiet. Night or deep dusk, lit by one small flame. Subject: [subject]
```

**The set, with filename and subject.** Subjects are written from the scene
kickers and the monster names, not from a full read of all 68 scenes. Check
each against its scene text before the final pass.

| File | Subject |
| --- | --- |
| `bell-lantern-cross.webp` | A crossroads hamlet at dusk, one iron lantern on a post where four cart tracks meet, a low stone inn, open moor behind |
| `bell-barrowmoor.webp` | A black still mere over a drowned moor, stepping stones, dead reeds, pale marsh lights low over the water, a leaning bell tower far off |
| `bell-chapel.webp` | Inside a half-flooded stone chapel, roof beams bare like ribs, black water over the nave, a cracked bronze bell in the tower above |
| `bell-epilogue.webp` | Grey dawn over the same moor, the water flat, one torch guttering on dry ground in the foreground |
| `thornwake-bridge.webp` | An old stone bridge over a gorge at night, a picket fire at the far end, thorn hedges, mist in the gorge |
| `thornwake-epilogue.webp` | The same bridge in cold morning light, the fire out, a tattered banner on the parapet |
| `harrow-moor-road.webp` | A rutted road across a wet moor in rain, a milestone, a mine headframe small on the skyline |
| `harrow-drowned-ox.webp` | A squat moorland inn at night, one lit window, a painted sign of an ox with no lettering, puddles |
| `harrow-green.webp` | A village green with a stone well and shuttered cottages, nobody about, fog at knee height |
| `harrow-winding-house.webp` | A pit-head winding house, a great wooden wheel and chain, coal dust, a lantern on a hook |
| `harrow-pump-stair.webp` | A stone stair going down beside iron pump rods into the dark, water running on the steps |
| `harrow-flooded-drift.webp` | A flooded mine tunnel, timber props, black water to the knee, a light far down the drift |
| `harrow-tithe-house.webp` | A long stone tithe barn with a heavy door ajar, ledgers and grain sacks inside, candlelight |
| `embers-hold.webp` | The gate of a mountain hold cut into rock, cold forge chimneys, snow, one brazier lit |
| `embers-karn-buruk.webp` | A vast forge hall underground, a single anvil, dull red light from a banked furnace, chains overhead |

**Aspect, size.** 21:9. Export 1344 x 576 WebP, quality 80, 90 KB or less each.
**Background.** Opaque panel. The CSS already gives it a border and shadow.
**One or a set.** A set of 15, generated in one sitting.

### N2. Characters page portraits (9 images)

**What and where.** `Pathfinder/characters.html`. Every dossier banner holds a
`.medallion` with initials in it (`<div class="medallion">KJ</div>`, line 299
and eight more). These are your own characters, so this is the set you will
look at most.

**Palette line:**
`Palette: near-black brown #120a07, parchment #ecdcb4, oxblood #7c1421, gold #b8862f, ember orange #e2703a. Background flat #120a07.`

**Prompt template:**

```
[house prefix] [palette line] [portrait convention] Character portrait for a
tabletop roleplaying character sheet. Subject: [subject]
```

| File | Subject |
| --- | --- |
| `kaeta-jadeharbor.webp` | A lean woman of mixed human and elf descent with slightly pointed ears, a monk in travel-worn wraps, hands raised in a tiger-claw fighting stance, a javelin strapped across her back, hair wet as if from a storm |
| `checkers.webp` | A small living cloth doll stitched from red and black checkerboard patchwork, button eyes, a stitched smile, a tiny lute, a performer's ruffled collar |
| `gus-sterling.webp` | A stocky human man in his forties, an electrician's tool belt over a patched spacer's jacket, a small mote of starlight orbiting one raised hand |
| `pharasmas-echoing-toll.webp` | A frail small-bodied alien scholar with a very large smooth translucent cranium, floating a little off the ground, serene and detached, a small bronze bell hanging at its chest, a faint spiral of pale light behind |
| `pip.webp` | A small furry six-armed alien with huge round eyes and bright teal fur, a light armoured vest with too many pockets, one hand holding a compact pistol, cheerful and alert |
| `ryn.webp` | A small kobold with short horns that glow faintly with magic, a barkeep's apron, a tankard in one hand and a lute slung behind, a crooked grin |
| `timun-dunvol.webp` | A halfling man with ink-stained fingers and a printer's apron, a magnifying lens held up to one eye, a pencil behind the ear, a watchful look |
| `ten-click.webp` | An ant-like insect person with a segmented body and four arms, a physician's satchel and a field medic's armband with a plain symbol, antennae lowered, a tired kind posture |
| `sannu.webp` | A feline humanoid with a lynx-like face and tufted ears, a trooper in worn armour plates, a blade of solid sunlight held low, calm eyes |

Read the dossiers before generating: only two have a "Who They Are" block
(Toll and Ten-Click) and Kaeta's says "Backstory pending", so the rest are my
reading of class, background and ancestry.

**Aspect, size.** 1:1. Export 320 x 320 WebP, 25 KB or less each.
**Background.** No transparency needed. The flat `#120a07` background matches
`--void`, and the medallion's `border-radius` does the circle crop.
**One or a set.** A set of 9.

### N3. Daredevil scene backdrops and title (12 images)

**What and where.** `Projects/daredevil/index.html:408`, the `#panel-art` box.
`getArtBg()` in `js/engine.js:556` maps 11 art keys to CSS gradients, and
`js/README.md` says of it "a background gradient, not an image". Those 11 keys
cover 232 scene uses, so 11 images change nearly every screen of the game. The
twelfth is the title screen at `index.html:367`.

**Skip the house prefix. Use this one:**

```
1970s screenprinted event poster illustration, three or four flat ink colours
with visible halftone dots and slight misregistration, on cream paper stock.
Palette: dark brown #241a12, cream #ede3d0, burnt orange #c25b2e, gold #d99a2b,
avocado green #7c8b3a, oxblood #8e2c1f. Low sun or floodlights, long shadows.
The centre third of the frame is dark and uncluttered. No text, no lettering,
no numbers, no logos, no brand names, no flags, no watermark, no border.
Subject: [subject]
```

The centre is kept dark because `#panel-art-label` and `#panel-art-bg-text`
draw over it.

| File | Key | Subject |
| --- | --- | --- |
| `title.webp` | title screen | A stunt rider seen from behind, astride a motorcycle at the foot of a wooden ramp under strings of fairground bulbs, plain leathers, plain open-face helmet |
| `cold_open.webp` | `cold_open` | A suburban backyard at dusk in the late 1960s, a child's bicycle beside a plywood ramp propped on trash cans |
| `milestone1.webp` | `milestone1` | A county fair dirt track at dusk, wooden bleachers, a ferris wheel behind, a short ramp |
| `stunt.webp` | `stunt` | Looking up a launch ramp toward a row of parked yellow school buses seen end-on, floodlights, dust in the air |
| `fr1.webp` | `fr1` | A cinderblock garage workshop, a motorcycle on a stand, tools on pegboard, one bare bulb |
| `m2.webp` | `m2` | A roadside diner booth at night, two coffee cups and a folded contract on the table, a motorcycle visible through the window |
| `fr2.webp` | `fr2` | A two-lane highway through farmland, a pickup towing a motorcycle trailer, late afternoon |
| `m3.webp` | `m3` | The mouth of an arena tunnel looking out onto a floodlit floor with a steel ramp, a full crowd as dots |
| `fr3.webp` | `fr3` | A motel room at night, a helmet on the bed, blue television glow, a neon sign outside with no readable letters |
| `m4.webp` | `m4` | A packed stadium at night, a long ramp and a line of cars parked door to door between the ramps |
| `fr4.webp` | `fr4` | A lakeside trailer at dawn, a motorcycle under a tarp, a folding chair, mist on the water |
| `m5.webp` | `m5` | An empty arena after the show, one work light, the ramp in silhouette, a helmet on the floor |

The key-to-subject mapping is my reading of the chapter titles ("The County
Fair", "The Investor Offer", "The Big Break", "The Defining Moment", "The
Question"). Open two or three scenes per key and adjust before generating.

**Aspect, size.** 16:9. Export 1280 x 720 WebP, 110 KB or less each.
**Background.** Opaque, used as a CSS background with `cover`.
**One or a set.** A set of 12.

### N4. Throneshard loading art (1 image)

**What and where.** `Projects/throneshard/src/ui/screens/Loading.js:34`. The
loading screen is CSS gradients and a spinning ring (`ui.css:173`). It is the
first thing anyone sees of the largest game on the board, and it is one image.

**Prompt (house prefix applies):**

```
[house prefix] Palette: near-black blue-grey #101317, antique gold #c8a255,
pale gold #f1d9a0, leaf green #6cc84a, ember red #e0503a. A wide river valley
seen from high above at dusk. Three roads cross the valley from the lower left
to the upper right. At the lower left a great stone throne under green-gold
light, at the upper right a jagged dark throne lit ember red. Between them a
river with a shallow ford, forest in deep shadow. The left third of the frame
is dark and empty. No characters, no creatures.
```

**Aspect, size.** 16:9. Export 1920 x 1080 WebP, 220 KB or less, plus a
960 x 540 copy at 70 KB or less for small screens.
**Background.** Opaque. The left third is kept dark for the loading text.
**One or a set.** One.

### N5. Bell to Bell classroom posters (4 images)

**What and where.** The four poster fixtures in `data/room.json:22-25`,
0.9 by 1.3 m, portrait. They hang public-domain oil paintings today
(`data/assets.json:61-68`), three of them landscape paintings fitted into a
portrait slot. A Trumbull portrait of Washington is a strange thing to find in
a classroom whose own treatment doc says "motivational posters have a
Sincerity stat and a Curl stat". Text rendering is what Nano Banana Pro is
good at, and this is the one place in the repo that wants text in the image.

**Skip the house prefix. Use this one:**

```
A printed classroom motivational poster from a late-1990s school supply
catalogue, photographed flat and square-on. Slightly sun-faded ink, a soft
curl at one lower corner, four small tape marks at the corners. A plain
coloured border, a large stock-photograph-style image in the upper two thirds,
one word in large capital serif letters beneath it, one short line in small
italic beneath that. No people, no children, no faces, no logos, no publisher
mark. The text reads exactly: [TEXT]. Image: [IMAGE]
```

| File | Text | Image |
| --- | --- | --- |
| `poster-perseverance.jpg` | PERSEVERANCE / The summit does not come to you. | A snow ridge leading to a peak at sunrise |
| `poster-teamwork.jpg` | TEAMWORK / Together everyone achieves more. | An empty eight-seat rowing shell on flat water at dawn, oars set |
| `poster-curiosity.jpg` | CURIOSITY / The only bad question is the one you keep to yourself. | A lighthouse beam over a dark sea |
| `poster-reading.jpg` | READ. / A book is a door that opens inward. | A stack of worn hardbacks beside a desk lamp |

Check every letter of the rendered text. Regenerate on any misspelling.

**Aspect, size.** Generate 2:3, crop to 9:13. Export 720 x 1040 JPEG, 90 KB or
less each. The game's textures are JPEG by rule and are written by a pipeline
recipe, not saved by hand (see section 7).
**Background.** Opaque. The picture-frame model supplies the edge.
**One or a set.** A set of 4.

### N6. Closing Time neighbourhoods and agents (12 images)

**What and where.** `Projects/Closing Time/js/ui.js:231`. A listing flyer shows
price, address and blurb and no picture, in a game that sells photo tiers
("Phone photos / Pro photos / Twilight + drone"). Six neighbourhood plates
fill all 28 flyers by neighbourhood. Six agent portraits go beside the
negotiation line at `ui.js:557`. Skip the 19 clients: too many faces for too
little screen time.

**Palette line:**
`Palette: paper #F5F1E8, ink #21262E, sign red #9E2B25, brass #8A6D2F, pine green #3E5C4B, pale line #C9C1AF.`

**Neighbourhood template:**

```
[house prefix] [palette line] A street view in a small American city, drawn
like an illustration from a 1960s realty brochure, daylight, no people, no
cars in the foreground, no readable signs. Subject: [subject]
```

| File | Subject |
| --- | --- |
| `nb-brackenridge-heights.webp` | Stone estates behind old clipped hedges, a gravel drive, tall trees |
| `nb-carver-mill.webp` | Postwar brick ranch houses on a quiet street, an old textile mill and its chimney behind |
| `nb-downtown.webp` | Lofts over storefronts on a main street, a courthouse clocktower at the end |
| `nb-lake-petrie.webp` | Lake cottages with wooden docks, a low sun over the water |
| `nb-maple-terrace.webp` | A tree-lined street of four-square colonial houses with deep porches |
| `nb-old-foundry.webp` | Brick warehouses with new windows, a half-renovated row of rowhomes, scaffolding |

**Agent template:**

```
[house prefix] [palette line] [portrait convention] Background flat #EDE7DA.
A real estate agent's headshot as it would be drawn for a brochure, business
dress, an invented person who resembles no real individual. Subject: [subject]
```

| File | Subject |
| --- | --- |
| `agent-chuck-brandt.webp` | A broad man in his fifties with a salesman's grin, loud tie, hand half-raised as if to shake |
| `agent-denny-kessler.webp` | A trim man in his forties in a sharp suit, a constant thin smile that does not reach the eyes |
| `agent-marisol-vega.webp` | A composed woman in her forties, dark blazer, level gaze, mouth closed |
| `agent-priya-natesan.webp` | A woman in her thirties with reading glasses, a tabbed binder held to her chest |
| `agent-ruth-okafor.webp` | A woman in her late sixties, warm and unhurried, a cardigan over a blouse, a small brooch |
| `agent-sal-dimeo.webp` | A heavyset man in his fifties in a rumpled jacket, mid-shrug, eyebrows up |

**Aspect, size.** Neighbourhoods 3:2, export 960 x 640 WebP, 80 KB or less.
Agents 1:1, export 256 x 256 WebP, 20 KB or less.
**Background.** Opaque for both. The agents' flat `#EDE7DA` matches `--paper-2`.
**One or a set.** Two sets of 6, each generated in one sitting.

### N7. The Absalom Inheritance heirs and endings (6 images)

**What and where.** The game opens on the "Choose Your Heir" picker, built at
`Projects/absalom-inheritance/js/ui.js:42` as `.pc-card`, with four text cards.
The ending modal (`ui.js:697`) is a title and a paragraph. Leave the board
alone: `tools/blender/budget.json` owns both sprite sheets.

**Palette line:**
`Palette: basalt black #0c0b10, slate #1e1b27, gold leaf #d4a843, bone #d8d3c8, blood red #b03a48, cold blue #7fa9d4.`

Heirs use the portrait convention with a flat `#16141d` background. Subjects:

| File | Subject |
| --- | --- |
| `heir-vesper-quill.webp` | A slight scholar-wizard, ink on the cuffs, a ribbon-marked book under one arm, lamplight on spectacles |
| `heir-kessa-vane.webp` | A broad-shouldered fighter in a worn gambeson, an old family longsword resting on one shoulder |
| `heir-isbeth-sarr.webp` | An older cleric called Mother Isbeth, grey braid, plain vestments with no holy symbol shown, a mace at her belt, one hand raised in blessing |
| `heir-nim-corvale.webp` | A wiry rogue with a satchel of picks and wedges, crouched, studying something just out of frame |
| `end-victory.webp` | A stone reliquary casket open on a plinth in a basalt vault, a sealed deed inside, gold light spilling out, dust in the air |
| `end-defeat.webp` | The same vault dark, a dropped lantern going out on the floor, a stone guardian standing motionless over it |

**Aspect, size.** Heirs 4:5, export 400 x 500 WebP, 40 KB or less. Endings 16:9,
export 1280 x 720 WebP, 110 KB or less.
**Background.** Opaque.
**One or a set.** A set of 4 and a pair.

### N8. Throneshard ability icons (14 sheets, 56 icons)

**What and where.** Every ability icon is an emoji today (`icon: '😤'` in
`src/gameplay/abilities/heroes/brakka.js:22`). `iconHTML()` in
`src/ui/util.js:80` already turns an image path into `<img class="ic-img">`,
so this is a data change. It ranks last because it is the most generations and
the most slicing, not because it matters least: emoji in a MOBA action bar is
the most unfinished-looking thing on the board.

Do abilities only. Leave the item shop on emoji until this set has proven it
can stay consistent.

**Sheet template (house prefix applies), one sheet per hero:**

```
[house prefix] A 2 by 2 grid of four square game ability icons with thin dark
gutters between them, each icon a single bold symbol filling its square,
readable at 48 pixels, heavy shapes, strong silhouette, one accent colour per
sheet on a near-black blue-grey #101317 ground with an antique gold #c8a255
rim light. Accent colour: [accent]. Top left: [1]. Top right: [2]. Bottom
left: [3]. Bottom right: [4].
```

| Hero file | Accent | Icons, in slot order |
| --- | --- | --- |
| `aldric` | steel blue | Thunder Gauntlet, Wide Sweep, Rally Shout, (4th: read the file) |
| `brakka` | blood red | Bloodfever, Whirling Riposte, (2 more: read the file) |
| `gorrow` | sickly green | Gut Hook, Blight Cloud, Stitched Hide, Devour |
| `isolde` | ice blue | Rime Burst, Ice Shackles, Wellspring Aura, Blizzard Veil |
| `kenshar` | lacquer red | Steel Cyclone, Mending Totem, Keen Edge, Thousand Cuts |
| `liora` | pale teal | Tether Shot, Piercing Gale, Tailwind, Arrow Storm |
| `morvane` | grave white | Grave Frost, Rime Armor, Dread Stare, Leaping Cold |
| `ondur` | ochre | Rift Wall, Totem Swing, Tremor, Deep Quake |
| `pell` | brass | Scattershot, Deadeye, Steady Sights, Final Round |
| `sable` | violet | Throwing Knife, Shadow Step, Haze, Killing Edge |
| `sera` | flame orange | Flame Wave, Pillar of Flame, Kindled Heart, Sunlance |
| `thalor` | storm yellow | Forked Spark, Skybolt, Storm Leap, (4th: read the file) |
| `vashkar` | toad green | Stone Spines, Toadcurse, Siphon Will, Death Mark |
| `vesna` | frost white | Chill Arrows, Hush Wind, Arrow Fan, (4th: read the file) |

Describe each icon by what it shows, not by its name: "a gauntlet wrapped in
lightning", not "Thunder Gauntlet". My name extraction got 52 of the 56
(`test/data.mjs:85` asserts 56); the four gaps are marked.

**Aspect, size.** Sheets 1:1 at 2K. Slice to four 128 x 128 WebP, 8 KB or less
each. About 450 KB for all 56.
**Background.** Opaque square tiles. `.ic-img` is `object-fit: cover`, so no
transparency and no cutout step.
**One or a set.** 14 sheets, all in one sitting, each using the first sheet as
its style reference.

### Cut from this list

- **Faire Weekend performer portraits (17) and vendor signs (12).** The data has
  names and quirk tags and no descriptions, so every portrait would be invented
  from a name. Write the descriptions first, then reconsider.
- **The Fracture Cycle plates.** It is a Dota 2 fan fiction and the only game
  here that is a single HTML file with fonts beside it. Art either depicts
  Valve's characters (do not) or is generic enough to add nothing.
- **Corner & Kettle storefronts.** Four images for a dialog seen once per
  prestige.
- **Numina nation banners (16).** See section 5. It is the largest visual gap
  on the site and the one with the most reasons not to fill it by generation.
- **`landing.html` backdrops.** The slots exist (`MEDIA.backdrops`) but the page
  is an unlinked mockup. Revisit the day it becomes the home page.
- **Fourth Quarter wall decor.** There are no poster or pennant fixtures to
  hang anything on. It would be new geometry, not an asset swap.

---

## 3. Veo list

The repo has one good use for video. No game uses `<video>` or a
`VideoTexture` today, and there is no `.mp4` or `.webm` anywhere in the tree.

### V1. Daredevil title loop (1 clip). Worth the credits.

**What and where.** A silent ambient loop behind the title screen,
`Projects/daredevil/index.html:367`. It is the one screen in the repo where a
few seconds of moving film grain and fairground light says what the game is
before any text does.

**How to make it.** Image-to-video from N3's `title.webp`, so the clip and its
poster frame are the same picture.

```
Animate this illustration as a living poster. Locked-off camera, no pan, no
zoom, no cut. The rider and the motorcycle stay completely still. Only these
things move: the strings of fairground bulbs sway slightly and two of them
flicker, dust drifts slowly through the light from left to right, a thin
thread of exhaust rises from the tailpipe. Keep the flat screenprint look, the
halftone dots and the limited palette of dark brown, cream, burnt orange and
gold. Warm low light from the upper right. No text, no new objects, no people
entering. 8 seconds. No audio.
```

**Looping.** It must loop. A locked camera with only ambient motion is the
trick: nothing travels far enough to jump. If the tool offers first-frame and
last-frame conditioning, give it the same still for both. If it does not, cut
the last second and crossfade it over the first in ffmpeg, which leaves a 7
second loop.

**Aspect, format, size.** 16:9. Export 1280 x 720, 24 fps, H.264 MP4 with the
audio track removed, 1.2 MB or less. A flat-colour illustration compresses far
better than live footage, so this is reachable. Poster frame: `title.webp`.

### Should be a still instead

- **Daredevil chapter cards (7).** They show for a couple of seconds. N3's
  backdrops already sit behind them.
- **Torchbearer title.** A torch flicker is twenty lines of CSS over a still.
- **`landing.html` hero video.** The `MEDIA.heroVideo` slot exists, but the
  WebGL canvas above it is opaque (`alpha: false` at line 1135, a solid
  `scene.background` at 1144), so the video would be covered once the canvas
  fades in. The hero is also already a live brass d20 in fog, which is better
  than a clip of one. Skip.
- **Fourth Quarter TV screens.** The canvas broadcast shows the league's live
  scores from game state. A looping clip would be wrong the moment a score
  changed.
- **A Throneshard or site trailer.** A trailer should be captured gameplay.
  Generated footage of a game that does not look like that is a false
  advertisement for it.

---

## 4. Don't generate

- **Anything in `assets/previews/`, `assets/og/` or `assets/tavern/`.** These
  are Blender renders and real gameplay frames, held to size, frame and byte
  caps by `blender/validate.mjs` and `blender/dioramas.mjs` in CI.
  `assets/tavern/` is an allowlist: a stray file fails the build. The previews
  README asks for "the game *playing*, not a title screen", and a generated
  image is neither.
- **Any sprite sheet.** Absalom's tiles and figures, Corner & Kettle's cups,
  Hearth's buildings, Orbital's bodies, Signal City's cars and Faire Weekend's
  markers each have a `budget.json` that holds palette, coverage and bytes.
  Hearth's holds every opaque pixel to a colour in `render.js`.
- **Skies, stars, water, fog, fire.** Golden Hour, Blue Hour, Aphelion and
  SkyWings draw these in shaders and canvas, and Golden Hour's README counts
  "0 asset bytes" as a feature. A painted skybox would be heavier and would
  stop moving.
- **PBR textures.** The 3D games take CC0 sets from Poly Haven and ambientCG
  with real normal maps. Generated textures do not tile and have no normals.
- **The Numina map.** It is 16 clickable SVG regions and its geography is the
  campaign's canon, which an image model would invent.
- **UI chrome, paper, wood grain, wax seals, ornaments, icons for buttons.** The
  board's notice cards are two radial gradients and a `clip-path`. That is
  sharper at every size than a raster and costs nothing.
- **Hearth, Integer Foundry, Orbital, Signal City, School Generator.** Hearth's
  stated identity is "no fonts, no images, no network". The other four are
  diagrams, and their tests read canvas pixels. Art behind them is noise.
- **The Bell to Bell sealed tile on `landing.html`.** It wants a 330 x 200
  capture of the real game, from `npm run previews`.
- **Throneshard hero portraits.** The game renders them from the hero models
  at runtime, so they always match what is on the field.

---

## 5. Constraints check

**Page weight.** Everything above totals about 5 MB of stills and 1.2 MB of
video against 292 MB of tracked files. No page loads more than one set, and
Torchbearer and Daredevil load one plate per scene. There is no site-wide byte
budget in CI, so the caps in this file are the only ones. Hold to them.

**GitHub Pages.** The limits are a 1 GB published site, a 100 MB hard cap per
file and a soft 100 GB a month of bandwidth. Tracked files are 292 MB and
`.git` is 571 MB. The risk is history, not the working tree: every regenerated
binary stays in `.git` for good. Commit final picks only, once, and keep the
rejects outside the repo.

**Bell to Bell's byte budget.** `data/assets.json` caps referenced assets at
13,700,000 bytes with about 253 KB spare. Four posters at 90 KB are 360 KB, but
they replace four paintings that total 1,779 KB, so the swap frees about
1.4 MB of referenced bytes. The paintings then count as unreferenced (5 MB
cap). Check that total before committing.

**Single-file pages.** Do not inline any of this as base64. The Fracture Cycle
(40 KB) and Integer Foundry (43 KB) are single files on purpose, and both are
on the cut list. Torchbearer is 253 KB of HTML and stays that way: its plates
load as separate files.

**Lazy loading.** Every `<img>` below the first screen gets `loading="lazy"`,
`decoding="async"` and explicit `width` and `height`. Portrait sets on one
page (Characters, the heir picker) are small enough to load eagerly.

**Video.** `preload="none"` with the poster set, `muted`, `loop`,
`playsinline`, no audio track in the file. Do not create the element at all
under `prefers-reduced-motion: reduce` or when `navigator.connection.saveData`
is set. `landing.html` gets this wrong today: it only turns autoplay off and
still fetches the file.

**Service workers.** Numina precaches everything under its `assets/` with a
`.png` or `.svg` extension so the site works in a field with no signal. Any
image added there is downloaded by every visitor up front. School Generator
caches `assets/` as immutable. Neither is in this list, and that is part of
why.

**Same-origin only.** `check-integrity.mjs` fails the build on any offsite
`<img>`, `<video>`, `<source>` or CSS `url()`, and on a local `url()` that
does not resolve. Each project vendors its own copy (#17): no shared
`assets/art/` folder.

**Format.** WebP for new illustration (the tavern plates set the precedent),
JPEG for Bell to Bell (its pipeline's rule). Check that each project's test
server knows the `.webp` MIME type before relying on it. Numina's do not.

**Age-appropriate.** Bell to Bell is about a classroom and its house rule is
"Kids are never the joke". Generate no images of children anywhere in this
list. The posters say "no people" for that reason. Daredevil is about crashes:
no injury, no blood, no wreck with a rider in it. Nothing here needs alcohol
branding, and The Fourth Quarter gets no generated art at all.

**Copyright and likeness.**

- **Daredevil.** A 1970s stunt rider in a white star-spangled jumpsuit and cape
  is Evel Knievel. The prompts say plain leathers and no flags. Stay away from
  canyon jumps and casino fountains, which are his two famous ones. No
  motorcycle brand names or tank badges.
- **Pathfinder and Starfinder.** Paizo's ancestry names, deity names and holy
  symbols are theirs. The portrait prompts describe bodies ("a small furry
  six-armed alien") and do not name ancestries or gods. Isbeth's prompt says
  "no holy symbol shown". Generate nothing for `campaigns.html`: those are
  Paizo's published adventures and their villains.
- **The Fracture Cycle.** Valve's characters. Cut.
- **Throneshard.** The heroes' kits map closely onto Dota 2 heroes. Describe
  icons by what they show, and never put a Dota name in a prompt.
- **Numina.** The setting comes from the campaign's published books and its
  content guide warns about depicting named people. Do not generate canon for
  somebody else's world without asking them.
- **Real people.** The Closing Time agents are invented. Never name an actor or
  a public figure as a reference, and do not write "in the style of" a living
  artist. Name the medium and the decade.
- **SkyWings 64.** Already close to Pilotwings by name. Add nothing that leans
  on it further.

**Provenance.** `assets/landing/README.md` says "every image on the page is a
render from this repo", and that has been true of the whole site. Add a
`CREDITS` line beside each new art folder saying which images are generated
and with what tool. Google's models embed an invisible SynthID mark, and on
some plan tiers a visible one. Look at the corner of the first export of each
tool before generating a whole set.

---

## 6. Batching plan

Three sittings of about 25 generations each, counting keepers and not retries.
Budget three to four attempts per keeper.

**Session 1. The two empty slots that already exist (24 images).**
N1 Torchbearer plates (15), N2 Characters portraits (9). Both are finished
games with a hole where the art goes, and neither needs anything from the
other sessions.

**Session 2. Daredevil, and the one clip (17 images, 1 video).**
N3 Daredevil (12), N4 Throneshard loading art (1), N5 Bell to Bell posters (4),
then V1 from N3's title still. Do V1 last, once the title still is final,
since the clip is generated from it. Spend video credits on nothing else.

**Session 3. Portrait sets and icons (18 images, 14 sheets).**
N6 Closing Time (12), N7 Absalom (6), N8 Throneshard icon sheets (14). If
credits run short, N8 is the one to drop: it is the only set that is worse
half-done than not done.

**Veo verdict.** V1 is worth it. Every other video idea in section 3 should be
a still or should not exist.

---

## 7. Integration notes

Paths are where the file goes. The change is described, not made. Each row is
one PR-sized piece of work inside one area's Ownership.

| Asset | Path | Code change |
| --- | --- | --- |
| N1 Torchbearer plates | `Projects/torchbearer/art/<name>.webp` | Add an optional `art` string to a scene in `packs/schema.json`. In the scene template (`torchbearer.html:2543`), emit `<img class="scene-art" src="torchbearer/art/…" alt="" width="1344" height="576" loading="lazy" decoding="async">` above `.scene-kicker` when the scene has one. Set `art` on the scenes of each bundled pack and the built-in adventure. Add `aspect-ratio: 21/9; object-fit: cover` to `.scene-art`. A player-loaded pack with an `art` path that does not resolve must fall back to no image: test that by breaking a path (#34). |
| N2 Character portraits | `Pathfinder/characters-assets/portraits/<slug>.webp` | In `characters.html`, put an `<img>` inside each `.medallion` with `alt=""` (the name is in the heading beside it) and keep the initials as the fallback when it fails to load. Add `overflow: hidden` and `object-fit: cover` to `.medallion` (line 173). Update the dossier template block at 715 to 755 and `tests/dossier-template.test.mjs` with it. |
| N3 Daredevil stills | `Projects/daredevil/art/<key>.webp` | In `getArtBg()` (`js/engine.js:556`), return `linear-gradient(…), url(art/<key>.webp) center/cover` so the existing gradient stays as the tint and the fallback. Add a dark scrim to `.panel-art` so the label text keeps its contrast. Title: a `background-image` on `#screen-title`. Update `js/README.md:115`, which says the panel is "not an image". |
| N4 Throneshard loading art | `Projects/throneshard/assets/ui/art/loading.webp` and `loading-960.webp` | In `ui.css:173`, add the image under `.ld-bg`'s gradients with `image-set()` or a `max-width` media query for the small copy. Add a line to the `CREDITS.txt` under `assets/`. |
| N5 Bell to Bell posters | `Projects/bell-to-bell/Assets/models/art/posters/<name>.jpg` | Add the four sources to the `bell-to-bell-textures` recipe in `Tools/board-check/asset-pipeline.mjs` and let it write the JPEGs (the project's rule: do not re-save a texture by hand). Point `art.paintings.posterA..D` in `data/assets.json` at them and move the four paintings into `_alternates.art`. Re-measure `_budget` and run `tests/assets.mjs`, `tests/props.mjs` and `tests/smoke.mjs`. `Projects/bell-to-bell/CLAUDE.md` governs. |
| N6 Closing Time | `Projects/Closing Time/assets/art/nb-<slug>.webp`, `agent-<slug>.webp` | Add an `art` field to neighbourhoods and agents in `tools/seed_data.py` and regenerate `data/`. In `js/ui.js:231`, add a `.flyer-photo` image from the listing's neighbourhood above `.flyer-price`. At `ui.js:557`, add the agent portrait beside `.npc-say`. The folder name has a space: URL-encode it or use relative paths. |
| N7 Absalom | `Projects/absalom-inheritance/assets/art/heir-<slug>.webp`, `end-<name>.webp` | Add a `portrait` field to each entry of `pcOptions` in `content/vault.json` and render it in `.pc-card` (`js/ui.js:42`). Add an image above `#end-title` (`ui.js:697`) chosen by outcome. Leave `assets/sprites/` and `tools/blender/` untouched. |
| N8 Throneshard icons | `Projects/throneshard/assets/ui/icons/<hero>-<slot>.webp` | Replace each ability's `icon: '…'` emoji in `src/gameplay/abilities/heroes/*.js` with the path. `iconHTML()` (`src/ui/util.js:80`) already handles it. Add an assertion to `test/data.mjs` that every ability's icon file exists, and watch it fail on one renamed file first (#34). |
| V1 Daredevil title loop | `Projects/daredevil/art/title-loop.mp4`, poster `art/title.webp` | In the title screen setup, create a `<video muted loop playsinline preload="none" poster="art/title.webp" aria-hidden="true">` behind the title text only when `prefers-reduced-motion` is not `reduce` and `navigator.connection?.saveData` is not true, and call `play()` on first paint. Otherwise leave the still. Extend `test/smoke-page.mjs` to assert that no `<video>` exists under reduced motion. |

Every row also needs: a credits line beside the new folder, the project's own
suite, and `cd Tools/board-check && npm run check && npm run social:check`.
