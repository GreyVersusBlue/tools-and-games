# Hearth v2 — Sprint 6 handoff ("Sound as place")

Deliverable: `hearth.html` (single file, ~157 KB, zero deps, runs from `file://`). Sprint 6 is complete and runnable on top of Sprints 1–5. This is the last sprint in the original build prompt, so this doc doubles as a note on where the thing stands.

## Changelog (5 lines)

1. **A real mixer.** Everything now runs through `master → ambient / sfx / music`, with rain wired straight to the master because rain is the thing everything else ducks under (ambient to .40 in a storm, .62 in rain; sfx to .70/.81). The sound toggle is one gain ramp on the master rather than five separate fiddles, and it is remembered in `localStorage` — the browser still wants a gesture before an `AudioContext` will start, so a remembered "on" arms a one-shot listener that starts the engine on the first click or key.
2. **Sound has a position.** `place(x,y)` turns a world coordinate into a gain and a stereo pan, measured from wherever the pointer last was (the hearth, until you move it). Every one-shot goes through it, so an axe forty tiles away is a tenth as loud and off to the left. Waves follow the same idea from the other direction: a low filtered wash whose volume is set by how close the shore is *to where you are looking*, loudest on the sand, halfway in the village, nearly gone out in open water. A spring you stand next to trickles.
3. **The island at work.** A thock per axe swing (~0.58 s), hammering on a build (~0.74 s), the mill creaking every four to ten seconds with the wind behind it, gull cries when the flock is up, birds by day and crickets by night, the bell at dawn, thunder still delayed by distance. All one-shots are capped at five per frame and 85 ms apart, so ten choppers at 10× speed sound like a village rather than a machine shop.
4. **Gentle procedural music.** A triangle pad on the root and fifth of the season's key (D, G, A minor, E minor), with single notes drifting in from that season's pentatonic every two to four seconds, panned about. It fades out at night and in storms and ducks under rain. When the season turns, the pad glides to the new key over about four seconds, which is slow enough to hear as weather rather than as an edit.
5. **A lullaby, and reduced motion.** Click a sleeping child and someone hums eight notes down the scale, with a log line for anyone playing with the sound off. `prefers-reduced-motion` now does real work: the lightning flash drops from full white to a third, rain and snow lose half their particles, fireflies stop flickering and just glow, the fire stops guttering, and gulls flap slowly.

**What I'd cut if it were too big:** the procedural music. The wind, waves, birds and work sounds already make the place; the pad is the one part a listener might want to turn off on its own.

## What I did, in order

- Rewrote the whole audio section. New state: `master, ambG, sfxG, musG, waveG, waveF, sprG, padG, padOsc[], nBuf, cur{x,y}, musT, musKey, sfxN, lastKnock`. `startAudio()` builds the graph once; `audioTick(dt)` is the only thing that moves gains, all through `setTargetAtTime`.
- **Audio never touches `R()`.** The old `audioTick` called `rnd()` for the bird timer, which meant turning the sound on changed the simulation's random stream and every outcome after it. Everything in the audio section now uses `Math.random` through a local `ar(a,b)`. This matters more than it sounds: it means a saved island replays the same with sound on or off.
- One-shots are built from two small primitives: `knock(...)` (a pitch-dropping sine body plus a filtered noise crack, used by `thock` and `hammer`) and `note(f,dur,vol,type,pan,bus,when)` (used by the music and the lullaby). `creak`, `gullCry`, `whoosh`, `splash`, `chirp`, `plink`, `bell` and `thunder` are each a handful of lines on top.
- Hooks in the simulation: `p.swing` accumulates in the `chop` and `build` cases; `gustAt` whooshes, `makeSpring` splashes, `rainOn` gives the cloud a long shhh, the skipped stone already plinked. The mill creak and the gull cries are scheduled from `audioTick` rather than the sim, so they follow real time and not the 10× clock.
- `cur` is updated on every `pointermove` and `pointerdown` over the canvas and reset to the hearth in `newWorld`.

## Tuning numbers that matter

- Measured at the master with an analyser: ambient floor ≈ .022 RMS on a clear day, thock .044, hammer .024, creak .025, gull .022, splash .021, bell .066, lullaby .031, storm floor .065. Ten thocks fired in one frame measure the same as one (.043).
- Duck: `storm .40 / rain .62 / snow .85` on ambient, `.5+.5×duck` on sfx, applied to music as well.
- Waves: `.01 + .075 × max(0, 1 − d/18)`, ×.3 under ice, ×1.8 in a storm. Spring: audible within 9 tiles.
- Music: notes every 1.9–4.2 s at .042, second note 34% of the time, pad .055 inside a bus that fades in over 7 s and out over 4 s. Roots: spring D3 146.83, summer G2 98, autumn A2 110, winter E2 82.4 (verified by FFT: the pad settles within one bin of the season's root, and glides between them on a season change).
- Timing with sound on: `step` .032 ms, `draw` 1.6–2.1 ms, `audioTick` .02 ms. No measurable cost.

## Issues / complications I hit

- **The `R()` leak.** Described above. Worth knowing if any future feature adds sound: use `ar()`, never `rnd()`, inside anything that runs from `audioTick` or from a click.
- **My first balance was wrong by about 3×.** The axe measured 7× the ambient bed, which is fine once and awful for an afternoon. The fix was a `lv` level argument on `knock` plus the 85 ms gate. If anything else gets added, measure it against the .022 floor rather than trusting it by ear once.
- **`localStorage` is not always there.** It throws outright inside a `data:` URL (which is how the preview harness serves the file), so `store`/`pref` swallow everything. On a real `file://` page in Chrome it works normally.
- **An `AudioContext` cannot start itself.** A remembered "sound on" cannot make noise until the user does something; the arming listener is registered with `capture: true` so the same click that plants a tree also starts the engine.
- **What is still unverified**: how any of it actually sounds on speakers. Everything here is verified by graph inspection, RMS and FFT measurement, which proves the sounds exist, are placed, are balanced against each other, and shift key with the season. It does not prove the music is pleasant. Listen to it before shipping anything on top of it.

## Victories

- Moving the pointer from the hilltop down to the water and hearing the sea come up is the whole sprint in one gesture. Nothing on screen changes.
- The season change is audible before it is visible: the pad starts gliding and a few seconds later the canopy turns.
- The rate limiter turned a wall of chopping into the sound of a village that has a lot on.

## Where the thing stands

All six sprints of the original prompt are in. The file is ~157 KB of the ~250 KB budget, still one file, no dependencies, no build step, opens from `file://` or GitHub Pages.

Quality-bar leftovers, if there is ever a Sprint 7:
- Sheltering islanders vanish entirely during a storm. A lit window would fix the feeling.
- The beached-boat pixel at the fishing hut is crude, and deer don't avoid water when fleeing across a narrow neck.
- A lone surviving child has no behaviour but `play`, so a village that collapses to one child stops moving.
- A storm-heavy first fortnight can stunt an island for forty days (storms send everyone indoors, hunger drives people off, and low food blocks new arrivals). Letting people work through light rain, or giving the granary a floor, would even it out.
- The music has no user volume of its own, only the global toggle.
