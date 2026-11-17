# Merchant: road map

Written 2026-11-16 from the planning conversation with Devon. "Merchant" is the
working name of the game and of this folder.

This file says what the game is, what has been decided, what is still open, and
the order the work is done in. It is the starting brief for the orchestrator.
The orchestrator's own design phase (M0) turns it into an architecture
document, a design document and a board of units. Where this file and a later
document disagree, the later document wins and this file gets corrected.

Every historical statement in this file is a planning draft. Nothing here is a
source. M1 verifies each one against a named source before it reaches a card.

---

## 1. The game in one paragraph

You run a merchant house in Cairo in the 1320s to 1340s. You do not travel. You
hire agents, give them cargo and a contract, and send them out along the Red
Sea, the Mediterranean, the Sahara and the road east. They are gone for
seasons. While they are away the work comes to your desk: letters from the road
that need a decision, orders from clients, disputes between partners, loans and
tolls. News arrives late, so you always buy on a guess. The game ends when the
plague reaches Egypt in 1347, and the score counts who came home as well as the
money.

It is the Oregon Trail's idea (a journey, a budget, bad luck, a score) seen
from the other end of the letter. That is also how the trade really worked:
long-distance merchants mostly stayed home and ran everything through agents
and correspondence.

## 2. Decided

These came from Devon in the planning conversation and are not the
orchestrator's to reopen.

| # | Decision |
|---|---|
| D1 | The player runs a company from a desk. The player is not the traveller. |
| D2 | The first home city is Cairo. Constantinople is the second, added after Cairo is complete. |
| D3 | The game ends with the arrival of the plague in 1347. |
| D4 | The audience is 7th grade. Text is written at that reading level from the first card. |
| D5 | Enslaved people are not a tradeable good and no card asks the player to deal in them. An About page says in plain words that this trade existed on these routes and is left out of the mechanics. |
| D6 | The educational content is in from the start, not added later. |
| D7 | For now the game is a standalone page on the site's quest board. Classroom use (a lesson around it, a teacher guide) comes later and must not be blocked. |
| D8 | The art is made in Blender and aims for a realistic look, as rendered still images. Devon runs the art on his Windows machine, by handing Claude Code one prompt per asset from an art list this project writes. |
| D9 | An Opus orchestrator runs development. Sonnet 5.5 workers do the writing, the research and the code, each in a new session, at most three at a time. A worker's session is archived once it has reported. No work between 22:00 and 04:00 Eastern. |

## 3. How it plays

### 3.1 The turn

A turn is one season. In a turn the player:

1. Reads what arrived: returns, letters, news of prices.
2. Works the desk: two or three cards, each a choice with a cost.
3. Outfits and sends any expedition they want to send.
4. Ends the season. Expeditions move, prices move, the world's events fire.

A turn should take about a minute once the player knows the game.

### 3.2 The span: three acts (draft, M1 confirms)

1320 to 1347 is about 110 seasons, which is too long to play. The draft is
three acts of two years each, 8 turns an act, 24 turns a game, with a short
"years pass" page between acts that carries the house forward (money, agents,
reputation) and says what changed in the world.

| Act | Draft years | What it is about | Draft set pieces |
|---|---|---|---|
| 1 | 1324 to 1326 | Learning the routes with a small house | Mansa Musa's pilgrimage passes through Cairo and gold loses value; a young traveller named Ibn Battuta arrives |
| 2 | 1335 to 1336 | A larger house, more at risk | The Mongol state in Persia breaks up and the road east turns dangerous |
| 3 | 1346 to 1347 | Reading the warnings | Rumours from the Black Sea, then the plague; recall your people or gamble |

A game is one sitting of about 30 minutes, and it saves after every turn.

### 3.3 The systems

- **Routes and seasons.** Each leg of a route has a length in seasons and the
  seasons it is open. The monsoon decides when a ship can cross to India and
  when it can come back. The Sahara is crossed in the cool months. Mountain
  passes shut in winter. Mediterranean sailing mostly stops in winter. Sending
  at the wrong time is the game's "ford the river" mistake.
- **Goods and prices.** About 10 goods. Each city has its own price for each,
  which drifts and reacts to events. The player's own sales push a local price
  down, so flooding one market is a lesson the player teaches themselves. The
  Mansa Musa event is the same rule at a king's scale.
- **Old news.** Prices are known only from letters, and a letter is one to
  three seasons old depending on how far it came. Every price on screen shows
  its date.
- **Contracts.** The player chooses how to fund an expedition: all of it alone,
  or a share with partners. An agent on a profit-share contract (the *qirad*,
  called *commenda* in Italy) takes a part of the profit; if the cargo is lost
  the investor loses the money and the agent loses the work.
- **Agents.** Six to eight invented people with a few traits each (careful,
  bold, honest, knows a city, knows a language) and a memory of how the house
  treated them. An agent treated unfairly leaves, or takes the cautious choice
  on the road when it matters.
- **Letters from the road.** An expedition in trouble writes home. The player
  answers, and the answer takes time to arrive, so some letters are reports of
  a choice the agent already made.
- **Desk cards.** Orders ("twenty bolts of silk by spring"), disputes (short
  weights, two partners claiming one share), loans, tolls, gifts, hiring.
  **Every card has a real trade-off and at least one consequence that shows up
  later.** A card with neither is cut.
- **Reputation.** One number per group that matters (partners, agents, the
  court, foreign merchants). It opens and closes cards.
- **Starting house.** Like the Oregon Trail's banker, carpenter and farmer: an
  established spice house (easy), a cloth merchant (middle), a newcomer (hard,
  with a score multiplier).
- **The ending and the score.** Wealth, reputation, agents who came home, and
  pages of the notebook filled. A short closing page says what happened to the
  house and what happened to the trade after 1347.

### 3.4 Cairo's network (draft, M1 fixes the stops and the times)

| Direction | Draft stops | Draft goods back |
|---|---|---|
| North by river and sea | Alexandria, then Venice, Constantinople, Tunis | Wool cloth, glass, timber, copper |
| South and east by Nile, desert and sea | Qus, Aydhab, Aden, Calicut | Pepper, incense, porcelain |
| West across the Sahara | The oasis road to Timbuktu and Mali | Gold, salt along the way |
| East by land | Damascus, Aleppo, Tabriz, Samarkand | Silk, paper |

What Cairo sells: linen, sugar, glass, and everything it re-exports. The final
list of goods is M1's.

### 3.5 Constantinople (M7)

A different game on the same engine, not a new skin. No Sahara and no monsoon.
Its routes are the Black Sea (Caffa, Tana, Trebizond) and the Mediterranean;
its goods are grain, furs, wax, alum and silk. The player is a local merchant
squeezed by the Genoese at Pera and by the Venetians, which makes it the hard
mode. The plague reaches it months before it reaches Egypt, so its third act
is shorter and harsher. The real Black Sea trade to Egypt was largely in
enslaved people; D5 applies and the About page says so for this city by name.

Each city is a folder of data (routes, goods, cards, events, agents, art
manifest). Adding a city must need no engine change. That is a test in M2.

## 4. The teaching

- **Every card carries a note** of one or two sentences, shown after the
  player chooses: what really happened and why. No quizzes.
- **A merchant's notebook** fills as the player meets things: terms (*qirad*,
  monsoon, caravanserai), places, people, goods. It is the glossary and it is
  part of the score.
- **Every card, note and notebook entry records its source** in the data. A
  teacher page is generated from that data later, with no second round of
  research.
- **Reading level is checked by a script**, not by eye: a readability score
  per card with a ceiling, and a word list for terms that must be explained in
  the notebook before a card may use them. The script exits non-zero.
- **Real people appear as they are recorded.** Mansa Musa and Ibn Battuta pass
  through the game as events. Nothing invented is put in a real person's
  mouth. Agents, partners and clients are invented.
- **Faith is part of the setting** (the pilgrimage caravan, the day business
  stops, the mixed communities of merchants) and is written factually and with
  respect.
- **Tone.** The Oregon Trail's dry humour is welcome when it is about cargo,
  camels and bad luck. Deaths are stated plainly. The plague is written
  without gore.
- **What it should leave a 7th grader with:** where these places are; why a
  thing is worth more far from where it is made; why seasons and winds set the
  calendar; how strangers trusted each other with money; that ideas, faiths
  and disease moved along the same roads as the goods.

## 5. The art

### 5.1 Direction

Realistic still images rendered in Blender with Cycles on the GPU of Devon's
Windows machine. Not real-time 3D: the game is a desk, a map and letters, the
public host serves `.glb` uncompressed, and a path-traced still looks better
than anything a browser can draw live. An Unreal pipeline was considered and
dropped: it cannot be driven end to end by scripts from Claude Code the way
`blender -b -P` can, and for still images it gains nothing over Cycles.

What scripted Blender does well, and the art leans on: still lifes (wood,
brass, paper, glass, coin, cloth on a table), architecture, ships, terrain,
sky, haze, low sun, candlelight, depth of field.

What it does badly, and the art avoids: faces and bodies close up, and animals
close up. So:

- **No face is ever close to the camera.** People are small figures in wide
  shots, backs, cloaks, hands at the edge of a frame, or absent.
- **An agent is shown by a seal and a hand of writing**, not a portrait.
- **Camels, horses and crews are seen at a distance** or as silhouettes
  against the light.
- **The world is seen from the desk and from far off.** Wide establishing
  shots at low sun with haze, and close still lifes. Nothing in between.

### 5.2 Rules for every asset

- One shared look: one colour transform, one set of sun and sky presets, one
  haze setup, one small set of lenses, one library of materials. They live in
  `tools/blender/common.py`, this project's own copy (locked decision #17).
- Headless only: `blender -b --factory-startup -P tools/blender/<script>.py`,
  on the Blender version the script pins, as the other pipelines in this
  repository do.
- Deterministic: fixed seeds, so a rerun gives the same picture.
- Masters stay off the repository. What is committed is the script and the
  shipped image.
- Shipped stills are 1920 x 1080 WebP at 400 KB or less. Sprites and objects
  are WebP with alpha. The whole Cairo set loads lazily, scene by scene.
- The map script also writes the pixel position of every stop to a JSON file,
  so the game's tokens and the picture cannot drift apart.
- No anachronism. Each prompt lists what must not appear (later buildings,
  New World crops, later ship types, wrong dress) with the reason.
- Every asset has a flat placeholder of the same name and size from M0. The
  game never waits for art, and an art pull request only replaces files.
  `assets/art/manifest.json` lists every asset with its size and whether it is
  a placeholder; a test checks the files against it.

### 5.3 The prompt format (ART.md, written in M1)

One entry per asset, complete enough to hand to Claude Code on the Windows
machine with no other context:

1. Id, file name, size, where the game uses it and what text sits over it.
2. The picture: subject, camera position and lens, time of day, weather, mood.
3. What is in it, with the historical reference for each thing and what to
   check it against.
4. Materials and light, by name from `common.py`.
5. What must not appear.
6. How to build it: script path, what to reuse, what to model new.
7. Output: resolution, samples, format, size ceiling.
8. Acceptance checklist the session checks its own render against, and how
   many rounds of render-look-fix it may take before stopping to ask Devon.

### 5.4 The asset list (first cut; M1 writes the prompts and may add or cut)

| Id | Asset | Used for |
|---|---|---|
| A01 | The desk by day: ledger, scales, letters, a window on the city | The main screen |
| A02 | The desk at dusk and by candle | Autumn and winter turns, the last act |
| A03 | The map table: a relief map of Cairo's network on a table, plus stop positions as JSON | Planning and tracking expeditions |
| A04 | Tokens with alpha: camel caravan, dhow, galley, Nile boat, mule train | Moving on the map |
| A05 | Cairo, a city gate at dawn, a caravan forming far off | Departure |
| A06 | Alexandria harbour | Mediterranean legs |
| A07 | A Red Sea port and a dhow under sail | Red Sea and India legs |
| A08 | Dunes, a caravan as a line on a ridge | Sahara legs |
| A09 | A mountain pass under snow | The road east in winter |
| A10 | A caravanserai courtyard at night, lamps, no faces | Road letters |
| A11 | A Sahel town of mud brick | The Mali end of the Sahara road |
| A12 | A covered bazaar, shafts of light | Tabriz and Damascus |
| A13 | A Malabar harbour in the monsoon | Calicut |
| A14 | A Venetian quay | Venice |
| A15 | Ten goods, one still-life rig, one render each | Cargo screens, the notebook |
| A16 | Objects with alpha: sealed letter, opened letter, contract, coin stacks, eight seals | Cards and agents |
| A17 | Event plates: storm at sea, sandstorm, a toll gate, a royal procession far off, an empty harbour with one ship at anchor | Set pieces and the ending |
| A18 | Title image, plus the board preview and the social card | The title screen and the quest card |
| A19 | The Constantinople set: desk, map table, the Golden Horn, Caffa, Trebizond | M7 |

About 50 renders for Cairo. A01, A03, A04 and A15 are needed first.

## 6. How it is built

### 6.1 House rules that shape it

The repository's `CLAUDE.md` binds every file. The ones that matter most here:
no build step and plain ES modules; zero offsite requests, everything vendored
inside this folder; a storage key never changes once shipped, with `migrate`
for version drift and `repair` on every load; a check exits non-zero; every
guard-rail is broken on purpose once; paths and scripts work on Windows; every
file here is a live URL.

### 6.2 Shape

- **The engine is pure and seeded.** State in, choice in, state out, with one
  seeded random source. It runs in plain Node with no DOM. The page is a view
  of the state.
- **Content is data.** Routes, goods, cards, events, agents and notebook
  entries are JSON under `data/<city>/`, each validated by a schema test. A
  card names its conditions, its choices, each choice's effects now and later,
  its note and its source.
- **The interface is DOM and CSS** over rendered stills, with tokens placed
  from the map's JSON. No canvas and no 3D library is planned.
- **Saves go through `assets/js/gvb-save.js`.** The key is chosen in M0 and
  never changed.
- **Board first.** Laid out for a classroom board and a laptop, then for a
  phone on its side and upright. Playable by keyboard alone. Readable from the
  back of a room. Reduced motion respected. Every still has alt text.

### 6.3 Folder

```
Projects/Merchant/
  index.html
  ROADMAP.md  ART.md  README.md
  css/  js/engine/  js/ui/
  data/cairo/  data/constantinople/  data/sources.json
  assets/art/  assets/fonts/
  tools/blender/  tools/   (content lints, balance bots)
  test/
```

### 6.4 Tests

| Suite | What it proves |
|---|---|
| Engine units, plain Node | Each rule: seasons gate legs, news ages, contracts split, saves round-trip |
| Content lint | Schema, a source on every card, a later consequence on every card, reading level, the banned-content list (D5), notebook terms defined before use |
| Balance bots | Thousands of seeded games by scripted players (careful, greedy, random): no route wins alone, a sensible player is not broke by turn 5, the scores spread |
| Journey, in a browser through the site's harness | A full game start to end by pointer and by keyboard; save, reload, continue |
| City swap | The engine runs a second, tiny invented city with no code change |
| Art manifest | Every file exists at its stated size; no placeholder is marked final |
| No offsite request | The page asks no other host for anything |

The bots are the answer to the main design risk. They cannot say a card is
fun, but they can say a route is always right or a card never matters, and
both of those are what makes a desk game a chore.

## 7. Milestones

Each one ends in something Devon can open. Units are one to two hours of
worker time, cut by the orchestrator in M0 and recut as it learns.

### M0. Design and foundation

The orchestrator does the design itself; foundation units run one at a time.

- Design document: every screen, the turn, the card anatomy, the tokens of the
  look (type, colour, spacing, motion).
- Architecture document: the state, the turn pipeline, the data schemas, the
  save, the test plan, the folder.
- A paper prototype: 15 cards and one season of play, written out for Devon to
  read. This is the first thing that can show the desk is fun or is not.
- Foundation: the folder and page shell, the seeded engine skeleton, the save
  with `migrate` and `repair`, the content schemas and lints, placeholders and
  the art manifest, the suite's place in CI, the area's ownership line.

**Ends with:** a page that loads, a document set, and 15 cards on paper.

### M1. Research and the world

Research and writing units, which run three at a time.

- `data/sources.json`: the books and articles everything rests on.
- The verified network: stops, leg lengths in seasons, open seasons.
- Goods and the price model's numbers.
- The timeline: what happened when, for the three acts.
- The first notebook entries and the About page text, D5's sentence included.
- **`ART.md`: the full prompt for every asset in 5.4.** From here the art runs
  on Devon's machine beside everything else.

**Ends with:** the world as data, each fact with a source, and the art list
in Devon's hands.

### M2. The expedition loop (first playable)

- Outfit, send, travel by season, return, pay out.
- The map table with moving tokens.
- Prices, the player's effect on them, and old news.
- Contracts and partners.
- The city-swap test.
- First balance bots.

**Ends with:** a game with no desk cards in which you send caravans and get
richer or poorer for reasons you can see. Lands on the site with no quest
card, so Devon can play it on any device.

### M3. The desk

- The card system: conditions, choices, effects now and later.
- Letters from the road and delayed answers.
- Agents with traits and memory.
- Reputation.
- The notebook and the note after each card.
- The first 60 cards for Cairo.

**Ends with:** the real loop. Lands, still with no quest card.

### M4. The whole game

- The three acts and the pages between them.
- The set pieces.
- The starting houses.
- The plague act, the ending and the score.
- Title, About, settings, save export.
- A balance pass with the bots, then a full playthrough by the orchestrator on
  a board-sized screen, a laptop and a phone.

**Ends with:** Cairo complete from title to score.

### M5. Art in, polish, first public landing

- Final art replaces placeholders as it arrives; nothing else waits for it.
- Motion, transitions, the feel of opening a letter.
- Accessibility and timing passes.
- The quest card on `index.html` and `landing.html`, the preview and social
  images, the social tags.

**Ends with:** the game on the quest board.

### M6. Depth

- Cards from 60 to about 150, so two games are not alike.
- A second balance pass.
- The teacher page generated from the sources in the data.

### M7. Constantinople

- Research, data, cards and art list for the second city (A19).
- The home-city choice on the title screen.

### M8. Classroom (not scheduled)

A teacher guide, a class-period mode, a printable log, a standards map. Starts
only when Devon asks. Nothing before it may block it: that is why the sources
are in the data from the first card.

## 8. How the work is run

- **The orchestrator** is one Opus 5.5 session. It designs, cuts units, hands
  them out, checks what comes back and lands it. It writes little product code.
- **Workers** are Sonnet 5.5 sessions, one unit each, each in a new session
  with its own worktree and branch. At most three run at once, and only units
  whose files do not overlap run together. Research and writing units overlap
  least, so they fill the three slots most easily.
- **A worker's last acts** are its report to the orchestrator and archiving
  its own session. The orchestrator archives any it finds finished and not
  archived at its next start.
- **Hours.** No worker is launched between 22:00 and 04:00 Eastern. A worker
  still running at 22:00 finishes its unit; the orchestrator records it and
  stops. A scheduled task starts a fresh orchestrator at 04:00.
- **Every report is checked**, not trusted: the commits exist, the unit's
  checks pass when the orchestrator runs them, the screen is opened and looked
  at, and a reviewer with no stake reads the diff against the unit's
  definition of done. Research units are checked by a second worker reading
  the cited source.
- **Landing** is one pull request per milestone from the integration branch
  into `main`, with CI green, merged with a merge commit.
- **Art** does not go through the workers. Devon runs each `ART.md` prompt on
  Windows; that session commits the script and the image and opens its own
  pull request, which touches only `assets/art/` and `tools/blender/`. No
  worker unit owns those two folders.
- **Where the files live.** This road map and `ART.md` are in this folder,
  because the Windows machine reads the art list from the repository. The
  orchestrator's own handoff, board, log and worker prompts are proposed to
  live outside the site, in `~/projects/merchant/`, as Schedule Visualizer 2's
  do, because every file here is a live URL (see Q2).

## 9. Open questions, with the assumption in force

The work proceeds on the assumption until Devon says otherwise.

| # | Question | Assumption |
|---|---|---|
| Q1 | Is Merchant separate from `BACKLOG.md`'s ranked table and `HISTORY.md`'s numbered decisions, the way Schedule Visualizer 2 is? | Yes. Its plan and decisions live with the orchestrator; the site's files change only at a landing. |
| Q2 | Do the orchestrator's handoff, board, log and prompts live outside the repository in `~/projects/merchant/`? | Yes. |
| Q3 | May the renders use free-licence (CC0) textures and sky images as inputs, downloaded on the Windows machine and listed in a manifest? They raise the realism a great deal. | Yes, procedural materials first, a CC0 input where it clearly looks better, every one listed with its licence. Nothing downloaded is served by the site. |
| Q4 | At 22:00, does a running worker stop at once or finish its unit? | It finishes its unit. Nothing new starts. |
| Q5 | Three acts of two years, or one continuous run of years? | Three acts, 24 turns. |
| Q6 | Does the game land on the site without a quest card from M2, so it can be played on a phone and a board while it is built? | Yes. |
| Q7 | Is "no close faces, agents shown by seal and handwriting" acceptable as the answer to what scripted Blender cannot do? | Yes. |
| Q8 | Sound. None is planned before M5, and there is no source for it yet. | No sound until Devon names a source. |
| Q9 | The folder is `Projects/Merchant/` with a capital M, and the address is case-sensitive. Rename if the game's name changes? | Keep the folder name even if the title changes; a moved address breaks links and saves. |

## 10. Risks

1. **The desk is a chore.** The commonest way this kind of game fails. Guards:
   the rule that every card has a trade-off and a later consequence, enforced
   by the content lint; the paper prototype before any code; the bots.
2. **The history is wrong.** A game for a classroom cannot be. Guards: no fact
   without a source in the data; a second reader for research units; real
   people only as recorded.
3. **The art cannot reach "realistic".** Guards: the direction in 5.1, which
   keeps to what scripted Blender does well; A01 and A03 made first as the
   test of the look, before the other prompts are run; placeholders, so the
   game does not wait.
4. **The reading level drifts up.** Research writes like research. Guard: the
   readability script in CI from M0.
5. **The art and the game drift apart.** Guards: the manifest, the stop
   positions written by the map script, fixed names and sizes.
6. **Three workers collide.** Guard: units own disjoint files; shared files
   belong to one foundation unit and change only when a unit runs alone.
