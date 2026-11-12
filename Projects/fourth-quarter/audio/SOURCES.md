# Where the Fourth Quarter's sounds came from

Every file under `audio/` is vendored; the game makes no offsite request for
sound. The measurements of each file are `levels.json`, written by
`tools/measure-audio.mjs`.

## Recorded with their source

| File | Key in `js/audio.js` | Source | Author | Licence | What was done to it |
| --- | --- | --- | --- | --- | --- |
| `sfx/events/crowd-cheer.ogg` | `crowdCheer` | "Well Done", <https://opengameart.org/content/well-done>, file `Well Done CCBY3.flac` | qubodup | CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>) | Fetched 2026-11-04 (TG-36). The 96 kHz mono FLAC, resampled to 44.1 kHz and encoded to Vorbis at quality 0.5 with GStreamer (`decodebin ! audioconvert ! audioresample ! audio/x-raw,rate=44100,channels=1 ! vorbisenc quality=0.5 ! oggmux`). Not trimmed or edited. |
| `sfx/footsteps/step-wood-a.ogg` | `footstepA` | "Different steps on wood, stone, leaves, gravel and mud", <https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud>, archive `[kdd]DifferentSteps_0.zip`, file `wood01.ogg` | TinyWorlds (the page is dated 2011-08-03) | CC0 (the page's licence field reads "CC0") | Fetched 2026-11-06 (TG-37). Copied unchanged, no re-encode: 44.1 kHz stereo Vorbis, 0.24 s, 8,569 bytes. The archive's other files (a third wood step, stone, gravel, leaves, mud) were not vendored. |
| `sfx/footsteps/step-wood-b.ogg` | `footstepB` | the same page and archive, file `wood03.ogg` | TinyWorlds | CC0 | Fetched 2026-11-06 (TG-37). Copied unchanged: 0.32 s, 9,832 bytes. `wood02.ogg` was skipped as a near twin of `wood01.ogg` (same 0.2446 s length). |
| `sfx/events/crowd-groan.ogg` | `crowdGroan` | Not recorded: the file came in as `crowd-groan.mp3` before sources were kept | unknown | unknown | Re-encoded from that MP3 on 2026-11-04 (TG-36): stereo, 44.1 kHz, Vorbis quality 0.5, the same GStreamer chain. It measures within 0.05 dB of the MP3 (loudest 400 ms -19.82 to -19.80 LUFS), so its trim did not move. |

The "Well Done" page says: "Congratulations win success sound. People
clapping. Own recording made at a hackathon then mixed." and "Changed to CC0
on 2024-10-05. Feel free to ignore the "CCBY3" in the filename now." Its tags
are win, success, applause, congratulations. It is a group clapping and
celebrating, not a stadium. Credit is not required under CC0; the author's
suggested line is "Well Done" by qubodup.

**Nobody has heard it in the game.** It was picked, levelled and wired on a
machine with no speakers. If it reads wrong at a Mules win, the CC0
alternative found the same day is "Cheers" by AuraVoice,
<https://opengameart.org/content/cheers-0> (2 s, a group of voices yelling,
CC0, "use however you like! No credit required"). The best-sounding cheering
pack on opengameart.org, Gregor Quendel's "Free Crowd Cheering Sounds", is
CC-BY 4.0, not CC0, so it was not used.

**Nobody has heard the footsteps in the game either.** The two takes were
picked by length and by the page's tags (step, footstep, wood), not by ear;
the archive's `stone01.ogg` or the third wood take are the swaps if they read
wrong. They are levelled by measurement to -44.6 LUFS (loudest 400 ms), far
under every cue.

## Not recorded

The other fourteen files were vendored before anyone wrote their sources
down, and this file does not guess at them.
