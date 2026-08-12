# 24 — Blue Hour

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
Do this *after* the summit defect above is settled — a preview shot at the summit today would
capture a black hillside. Shoot the trail, which reads well right now:

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

1. **Settle the summit.** It is the payoff of an 860 m climb and it currently renders as a
   black hillside with an invisible cloud sea. The two honest options: give the mountain a real
   peak so the ground falls away and the sea plane clears the terrain (costs a `smoke.mjs`
   golden-height rebaseline), or drop the sea and rewrite the promise — the piece could end
   *in* the fog rather than above it, which is arguably truer to its own thesis. Either way the
   ground shader needs an alpine treatment above the fog line so the payoff view is legible at
   all. Turn `browser.mjs`'s two OPEN FINDING notes into assertions once it lands.
2. **The direction question, now with numbers in hand.** Journal/verbs/photo mode (parity with
   Golden Hour), stay a pure verb-less walk (and write that into the prompt as a locked
   decision so no future session "fixes" it), or push further into what the piece is already
   best at — more in `dread.js`, a darker second half, the summit costing something. The draw
   budget says there is a lot of room whichever way it goes.
3. **A real GPU run.** Everything here is swiftshader at 1.7 fps. The geometry numbers are
   honest and comfortable, but this piece leans hard on large transparent billboards in fog —
   ferns, silhouette cards, mist, shafts — which is fill-rate cost that software rasterization
   reports very differently from a real GPU. Nobody has measured the actual frame rate of this
   piece anywhere.
4. **A touch playtest on real glass.** The controls have a hold-the-bottom-third-to-walk scheme
   that has never had a thumb on it.
5. **Ears on for an hour.** The dread scheduler's cooldowns (55–100 s, first beat at 70 s) and
   the fog periods (211 s and 337 s) are all unheard guesses. They want a real walk, not a
   scrub.
