# 24 — Blue Hour

## Session 2 — the walk ends in the fog

Devon set the thesis this session, and it reframed the open item rather than answering it:
*this is not a place we want to be, and we want to get out — but the fog hides something.*
Under that reading the summit defect stopped being a rendering bug and became a design one. The
piece had been building toward a scenic reward at the top of a climb that is supposed to feel
like somewhere you are trying to leave.

**The altitude blend inverted.** `altT` drove seven things and every one of them was relief:
fog thinning to 0.006, light coming up, exposure opening, mist and shafts and fireflies fading
out, a cloud sea appearing. All of it now runs the other way. The summit is the thickest air on
the mountain (density 0.055, worse than THICK's 0.046), the light goes out of it, and the mist
gets *heavier* with altitude instead of clearing. Shafts and fireflies still fade — no light
gets through up there to make a shaft of, and fireflies belong to the woods — and losing them
is part of arriving.

One term rises: ambient. Without it the near ground renders black, which is an unlit frame
rather than atmosphere. That single exception is the entire fix for the old 6–14/255 problem —
and it is worth being precise about why, because it was nearly free: **the summit read black
because `altT` was dropping the fog to 0.006.** Restore thick fog and the fog itself lifts the
ground again, exactly as it does on the trail below. No alpine shader, no treeline, no
heightfield work. Measured after: **24.3/255**, better than the trail's 22.

**The cloud sea and the distant peaks are deleted.** `buildSummitPayoff()` is gone from
`atmosphere.js`, replaced by a comment explaining what was there and why both its geometry and
its intent were wrong. The mountain still has no peak — see "Deliberately not done".

**`dread.js`'s altitude rule flipped.** It read `deepWoods = pos.y < 48` and suppressed the
silence, shape and eyes beats above the fog line, on the stated principle that "above the fog
line the mountain is honest". That made the summit a refuge. Now a `highT` ramp over the same
46→62 m band main.js uses *satisfies* those gates instead of blocking them, feeds `intensity`,
and shortens the cooldown by up to 30%. High on the mountain the weather no longer has to
cooperate for the woods to lie to you.

**Somebody is in the fire lookout.** The tower was already built and placed and had nothing to
do with anything. It is the only structure at the top and the only thing on the mountain that
implies other people — someone built it, someone was meant to sit in it. There is now a figure
at the platform rail that turns to keep facing the walker wherever they go.

It is the piece's one exception to its own vanishing rule: the shape in the trees is gone when
you look back, and this is not. It buys that exception three ways — capped at half opacity so
it never resolves, fogged like everything else, and **gone from the rail entirely once the
walker reaches the foot of the tower**. Walking up to a thing for a better look and having it
step out of view is worse than either finding it or finding nothing, and it keeps the rule that
a monster you can see clearly is just a prop. It never moves from the platform, never comes
down, and nothing follows the walker back down the mountain.

Placement took three attempts and the reason is arithmetic, recorded so nobody repeats it: the
cab is 2.6 m across, the platform 3.4, so the walkway around the cab is **40 cm**. A 0.78 m
figure anywhere on the near rail is half-behind a near-black cab from the approach — the first
two placements came back as an invisible smudge and then a sliver. It stands at the side rail
now, out past the cab's half-width plus half a body, where fog is the background instead of the
tower.

### What I verified (session 2)

- `node test/smoke.mjs` — **47 checks, 0 failed** (was 46). New: the tower sits inside the
  figure's readable band from the bench (10.0 m, band 6.5–70). That check exists because the
  geometry nearly defeated the feature — an earlier band of 11–95 m would have hidden the
  figure at the exact spot the walk ends.
- `node test/browser.mjs` — **32 checks, 0 failed** (was 25), zero page errors. The two OPEN
  FINDING notes are now assertions: the fog closes at the top (density 0.055 at altT 1.00) and
  the summit is legible (24.3/255, floor 18). Five new checks cover the figure: on the platform
  not the ground, visible from the bench, never over half opacity, **survives a look-away and
  look-back**, and gone at the foot of the tower.
- Luminance is now read in-page off the drawing buffer inside a `requestAnimationFrame` rather
  than by decoding a PNG, so the suite needs no image decoder. The renderer runs without
  `preserveDrawingBuffer`, so sampling outside that frame returns an empty buffer.
- Eyes on, four standoff distances (40, 22, 12, 8 m): at 22 m the tower is a shape in fog and
  the figure is deniable; at 12 m it is unmistakable once noticed. Draw calls at the summit
  30, triangles 280k — the figure costs one call.

---

First notes file for this piece. Blue Hour landed in one commit (`4049d32`, PR #8) with no
notes file behind it, which is why nothing downstream knows it exists: it is not on the board,
it has no preview, it is not in `Tools/board-check/games.mjs`, and it has never been opened in
a browser by anything other than a person. This session did not add world; it built the
machinery that makes the piece visible, testable and safe to change, and it found one real
defect on the way. The expansion direction is deliberately still open — see **Next session**.

## What changed

**A debug hook, `?debug` → `window.__bh`** (`js/main.js`). Same bargain Golden Hour struck in
its session, for the same reason: a regression suite cannot walk 860 m in real time, cannot
wait out a 337-second fog period to see the thick phase, and cannot stand in the woods for the
~70 s before dread's first beat and then hope the coin lands on the beat it wanted. The doors
in are `setWeatherT`/`getWeatherT`/`fogT`/`altT` (the fog cycle is this piece's sun, and
scrubbing it is how you see both phases in one run), `teleport`/`face`/`pos`/`surface`,
`cairns`/`layout`, `trail`/`yawAlongTrail`, `fireDread`, `dread`, and `info`. Nothing in the
piece itself opens any of them.

`yawAlongTrail` exists because of a bug I wrote and then had to diagnose: the trailhead sits at
z 145 with `BOUNDS.maxZ` at 150, so a test that guesses "face +z and hold W" walks into the
edge of the world 5 m later and reports a movement bug that isn't there. Handing tests the
centerline is cheaper than every future session rediscovering that.

**`dread.js` split `tryFire` into `tryFire` + `runBeat`.** Choosing a beat and staging one were
one function, so a beat could only be reached by satisfying its fog/elevation gate and then
winning a weighted random draw. `runBeat(beat, camera, controls)` now owns the staging, and
`state.force(beat, camera, controls)` is the only caller that bypasses the gates. `_lastBeat`
moved into `runBeat`, so a forced beat still can't repeat on the next natural fire — the
"never the same beat twice running" rule holds across both paths. No behaviour change in play;
the scheduler is still the only thing that fires beats.

**A browser half of the test suite, `test/browser.mjs`.** Serves the site root over a throwaway
http server (so the import map and `libs/` resolve exactly as they do in play), boots the real
page in real Chromium through `?debug`, and asserts across seven groups. It needs
`playwright-core` and a Chromium on disk, neither of which is a dependency of the piece — the
piece still has none, and still makes zero offsite requests. `CHROME=/path/to/chrome` overrides
the binary. `test/shots/` is gitignored.

Absolute timing under software GL is worthless, so the suite measures its own frame rate and
scales the one timing assertion by it rather than hard-coding a distance. Under swiftshader it
sees **1.7 fps**, and `main.js` clamps `dt` to 0.1 s, so the world genuinely runs in slow
motion at roughly a tenth speed. That clamp is correct — it stops a stalled tab from teleporting
the walker — but it means any future session reading a walk distance here must scale it.

## What I verified

- `node test/smoke.mjs` — **46 checks, 0 failed**, unchanged before and after the `dread.js`
  split.
- `node test/browser.mjs` — **25 checks, 0 failed**, real Chromium, zero page errors from boot
  to teardown. Groups: boots (trailhead position, surface underfoot, hook present), draw
  budget, the fog cycle, the climb, the cairns, every dread beat, the walk.
- **Draw budget: 35 calls, 280k triangles** at 1320×800 in the woods; **19 calls** at the
  summit. Golden Hour's stated budget was 300 calls and it measured 157. Blue Hour has more
  than twice Golden Hour's trees and uses a fifth of its draw calls, because the forest is
  instanced.
- **The weather does not change the draw cost** — 35 calls and 280k triangles are identical in
  the thickest fog and the clearest, which is worth knowing and is not what I assumed going in.
  The fog is mood and depth-precision headroom; it is *not* a culling strategy. Nothing is
  hidden by it that wasn't already being submitted. This is fine at the current budget and it
  is the number to watch if the forest ever grows.
- **The fog cycle reaches both ends** — 0.00 to 1.00 across a 1400 s scrub, so neither extreme
  is theoretical.
- **The climb works**: the bench stands at y 63.4, `altT` saturates at 1.0, the summit view
  costs 19 draw calls.
- **All seven cairns** are reachable, counted, and the seventh flips the chip to "all seven
  cairns".
- **Every dread beat** — snap, phantom, silence, howl, bear, eyes — stages without a page
  error; the shape comes up active with a 40 s life, and `birdsSilent` flips on cue.
- A 6 s W-hold up the trail covers ground, gains elevation, and leaves the walker still on the
  trail rather than lost in the woods.

### The one real defect: the summit payoff does not render

The README promises the climb ends in "thin bright air over a cloud sea". It does not. Two
independent causes, both measured:

1. **The cloud sea is inside the mountain.** `atmosphere.js` puts it at y = 46, a ring of
   radius 40–200 around the trail end at (-5, -100). The terrain there is a broad plateau, not
   a peak — sampling `groundHeight` every 5° around that ring gives a mean of ~60 m at every
   radius from 40 out to 200. At r = 40 **100% of the ring is underground**; at r = 200, 60%
   still is. From the bench at y 63.4 the plane is below the ground you are standing on in
   nearly every direction, so the reveal it fades in can essentially never be seen. The
   `summit.sea.material.opacity = altT * 0.9` line is doing its job on an object nobody can
   look at.

2. **Above the fog line nothing lifts the ground colour any more.** The fog was doing all the
   work of making the ground legible, and the forest floor has no alpine or high-elevation
   treatment in the ground shader. Lower-half mean luminance of the frame at the bench is
   **6–14 / 255 depending on facing**, against **22 / 255** on the trail below — and the trail
   is already deliberately dim. Turning a full circle at the summit, every direction is a black
   hillside under a pale sky.

Captures are in `Projects/blue-hour-trail/test/shots/` (gitignored; re-shoot with
`node test/browser.mjs` and the four-way summit script in the session scratch). `browser.mjs`
prints both measurements as `note` lines under an **OPEN FINDING** group rather than asserting
them — the fix is a world-design decision, not a tuning nudge, and a permanently red suite is
just a to-do list nobody can run. Turn them into assertions the moment the summit is rebuilt.

I did not fix it this session on purpose. Every available fix changes the mountain — either the
heightfield grows a real peak with ground that falls away (and `smoke.mjs` pins twelve trail
and terrain expectations that would move with it), or the cloud sea drops and the plateau gets
carved. That is Devon's call, not a cleanup.

## Shared-file requests

Three, all mechanical. None of this can be done from inside the project directory.

**1. `index.html` — put Blue Hour on the board.** It has been shipped and unreachable since
PR #8. Insert immediately after the Golden Hour `<a class="notice">` block (currently ending at
the `#g-sun` seal, around line 457), so the two hours sit together:

```html
  <a class="notice" data-tags="Explore" data-new data-preview="assets/previews/blue-hour.jpg" href="Projects/blue-hour-trail/">
    <span class="pin" aria-hidden="true"></span>
    <div class="eyebrow">QUEST POSTED</div>
    <h3>Blue Hour</h3>
    <p class="desc">Climb a fog-bound mountain trail at dusk — and try not to look too closely between the trees.</p>
    <div class="reward">REWARD: <b>THE VIEW ABOVE THE CLOUD LINE</b> · WALKING SIM</div>
    <span class="seal" aria-hidden="true"><svg class="glyph"><use href="#g-peak"/></svg></span>
  </a>
```

That references a seal that does not exist yet. Add it to the `<defs>` block, after the
`g-orbit` symbol on line 352, in the same stroke-only idiom as its neighbours — a ridge line
with the fog lying across it:

```html
  <symbol id="g-peak" viewBox="0 0 24 24"><path d="M2.5 17 9 6.5l4.2 6.8L16 9l5.5 8z"/><path d="M3.5 20.2c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0 2.8-1.1 4.2 0 2.8 1.1 4.2 0"/></symbol>
```

If a new symbol is unwelcome, `#g-star` is the best existing fallback and the card works
unchanged with it. Do not use `#g-sun` — that one is Golden Hour's, and the pair should not
share a seal.

**2. `Tools/board-check/games.mjs` — register the piece** so the integrity, collision and
preview passes stop skipping it. It boots exactly like Golden Hour (click `#overlay`, never the
canvas — while the overlay is up it covers `#scene` and a canvas click never lands):

```js
  // ---- Blue Hour: the deliberate sibling of Golden Hour, and it boots the same
  // way — click the overlay, not the canvas.
  'blue-hour': {
    title: 'Blue Hour',
    url: '/Projects/blue-hour-trail/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/blue-hour-trail/libs/three.module.js',
    intro: ['#overlay'],
    async open(p, { probe } = {}) {
      await p.waitForSelector('#scene');
      if (probe) await probe();
      await p.click('#overlay');
      await p.waitForSelector('#overlay.hidden', attached);
      await wait(1200);
    },
  },
```

There is no `saveKey`: the piece has no save, on purpose.

**3. `Tools/board-check/capture-previews.mjs` — a recipe, then `npm run previews blue-hour`
and `npm run promote`** to produce `assets/previews/blue-hour.jpg`, which request 1 points at.

> **Amended, session 2.** This request originally said to shoot the trail *because* the summit
> captured as a black hillside. That is fixed — the summit now reads at 24.3/255 and the fire
> lookout in fog is the strongest single frame in the piece. Either shot is defensible now. The
> trail recipe below still works and is the safer capture (it needs no teleport and no debug
> hook); a summit shot would need `__bh.teleport(bench)` and a facing, and would give away the
> figure on the board card, which is an argument against it. Shooting the trail on purpose
> rather than by necessity.

```js
  // ---- Blue Hour: stay in the woods. The trail corridor with the footbridge
  // ahead is the piece's best single frame; the summit is under repair (see
  // notes/24-blue-hour-notes.md) and shoots near-black.
  'blue-hour': {
    async play(p, { shot }) {
      await p.keyboard.down('KeyW'); await wait(4000); await p.keyboard.up('KeyW');
      await wait(1500);                 // let the mist layer drift
      await shot('trail');
      const c = await camState(p);
      return `walking at ${c.pos.join(', ')}, yaw ${c.yaw}`;
    },
  },
```

The `?debug` hook is available to any of these if a deterministic frame is wanted:
`__bh.setWeatherT(t)` pins the weather, `__bh.teleport(x, z)` and `__bh.yawAlongTrail(i)` place
and aim the walker, `__bh.info()` reads the draw counts.

**4. `Claude Prompts/notes/README.md` — add this file to the expected-names list.** The list
stops at 23. Add to the right-hand column:

```
24-blue-hour-notes.md
```

Blue Hour now has a prompt file of its own at `Claude Prompts/24-blue-hour.md`, written this
session; it did not have one before, which is the root cause of everything in requests 1–3.

## Deliberately not done

- **The summit was not rebuilt.** Documented above with numbers instead. Every fix moves the
  heightfield or the world layout, and `smoke.mjs` pins expectations that would move with it.
- **No save, no journal, no interaction verbs, no photo mode.** Golden Hour has all four; Blue
  Hour has none, and this session did not close that gap because whether it *should* close is
  the open question, not a backlog item. Devon's call this session was explicitly "plumbing
  first, then plan".
- **The `dread.js` split is the only change to a piece file.** `state.force` is additive and
  unreferenced in play; the gates, cooldowns and weights are untouched. A refactor of dread's
  scheduler into a registry (Golden Hour's creature pattern) was considered and dropped — it is
  tuned, it is tested, and a mechanical move risks regressions for zero player-visible gain.
- **No LOD or culling work.** Measured first: 35 draw calls and 280k triangles against a budget
  of 300 calls. There is nothing to optimise, and the instancing is already doing it.
- **No `saveKey` in the board-check request.** Adding one would imply a save the piece does not
  have.

## Next session

1. **Settled, session 2** — the walk ends in the fog and there is someone in the lookout. What
   is left of it: the mountain still has no peak (`mountainH` is a ramp in `z`) and the last
   stretch of trail still rides a ~5 m berm. Both are invisible under the new weather and both
   become real again the instant anyone lifts the fog at the summit. Written into the prompt
   file so a future session can't rediscover them the hard way.
2. **The direction question, narrowed.** The ending pass committed hard to dread over
   collection, so Golden Hour parity is now the odd option out and shouldn't be adopted without
   asking. The live choice is: keep pushing into `dread.js`, or write "no save, no verbs, no
   collection" into the prompt as a locked decision. Related and more interesting: the beats
   are still the same five everywhere on the mountain — only their *rate* changes with
   altitude. Something should change in kind up there. The figure is one answer and currently
   the only one.
3. **A real GPU run.** Everything here is swiftshader at 1.0–1.8 fps. The geometry numbers are
   honest and comfortable, but this piece leans hard on large transparent billboards in fog —
   ferns, silhouette cards, mist, shafts — which is fill-rate cost that software rasterization
   reports very differently from a real GPU. Nobody has measured the actual frame rate of this
   piece anywhere.
4. **A touch playtest on real glass.** The controls have a hold-the-bottom-third-to-walk scheme
   that has never had a thumb on it.
5. **Ears on for an hour.** The dread scheduler's cooldowns (55–100 s, first beat at 70 s) and
   the fog periods (211 s and 337 s) are all unheard guesses. They want a real walk, not a
   scrub.
