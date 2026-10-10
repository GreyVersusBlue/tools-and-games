// audio.js — SFX/ambience registry + player. Browser-only (HTMLAudioElement),
// same spirit as materials.js: one place that maps a short key to a file on
// disk, everything else just calls playSfx()/startLoop() by key.
//
// One-shots are cloned per play so overlapping triggers (two tickets landing
// close together) don't cut each other off. Loops (ambience, QTE sizzle/pour)
// keep a single persistent element that gets started/stopped/faded instead.
//
// NOT WIRED (no source file yet, left as TODO so gaps don't get lost):
//   - crowd cheer on a Mules win (only crowd-groan.mp3 exists — a loss plays,
//     a win currently stays silent beyond the final-whistle stinger)
//   - footsteps (audio/sfx/footsteps/ is empty)
//   - music (audio/music/ is empty — Phase 1 item, later sprint)

const BASE = "audio/";

const SFX = {
  orderDing:      "sfx/order-ding.ogg",
  ticketReady:    "sfx/ticket-ready-bell.ogg",
  cashRegister:   "cash-register.ogg",
  uiClick:        "sfx/ui/ui-click.ogg",
  uiOpen:         "sfx/ui/ui-station-open.ogg",
  uiClose:        "sfx/ui/ui-station-close.ogg",
  qteHit:         "sfx/qte/qte-hit-perfect.ogg",
  qteMiss:        "sfx/qte/qte-miss.ogg",
  crowdGroan:     "sfx/events/crowd-groan.mp3",
  stormOut:       "sfx/events/patron-storm-out.ogg",
  stingerKickoff: "sfx/events/stinger-kickoff.ogg",
  stingerFinal:   "sfx/events/stinger-final-whistle.ogg",
};

const LOOPS = {
  barBed: "ambience/bar-bed-crowded-pub-loop.ogg",
  sizzle: "sfx/qte/qte-sizzle-loop.ogg",
  pour:   "sfx/qte/qte-pour-loop.ogg",
};

// The mix (#942). Every sound is played at TRIM[key] times the master volume
// times whatever the call site passes, which is 1 everywhere but the staff's
// cash register. The trims are what level the files against each other: the
// files as vendored sit 22.6 dB apart (the final whistle's loudest 400 ms
// reads -4.0 LUFS and the UI click's -26.6), and an <audio> element can only
// turn a file down. audio/levels.json holds each file's measured loudness,
// test/smoke-mix.mjs multiplies it by gainFor() and fails when a role leaves
// its band, and the README's "The mix" has the table before and after.
// Nobody had listened to these numbers when they were written.
export const MASTER = 0.8;

export const TRIM = {
  // order and ticket cues, the QTE result, the two stingers: 26 LUFS under
  // full scale at the master above, each within 1 dB
  orderDing:      0.28,
  ticketReady:    0.60,
  cashRegister:   0.25,
  qteHit:         0.18,
  qteMiss:        0.56,
  stingerKickoff: 0.85,
  stingerFinal:   0.10,
  // the panels and buttons, 4 dB under the cues
  uiClick:        0.85,
  uiOpen:         0.14,
  uiClose:        0.14,
  // the crowd, each of the three 12 to 13 dB down on what it was. A walkout
  // is 13 seconds long and three can be sounding at once.
  crowdGroan:     0.25,
  stormOut:       0.22,
  barBed:         0.08,
  // the two QTE loops, level with each other and as they were (0.55)
  sizzle:         0.60,
  pour:           0.60,
};

let masterVol = MASTER;
let muted = false;

const oneShotCache = {};   // key -> template Audio element (cloned on play)
const loopState = {};      // key -> { el, vol, playing }

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** The volume an element is set to for this key: the one place it is worked out. */
export function gainFor(key, vol = 1, master = masterVol) {
  return clamp01(vol * (TRIM[key] ?? 1) * master);
}

/** Every key that has a file, and the file. For the measuring tool and the suite. */
export function files() {
  const out = {};
  for (const k in SFX) out[k] = { file: BASE + SFX[k], loop: false };
  for (const k in LOOPS) out[k] = { file: BASE + LOOPS[k], loop: true };
  return out;
}

/** Fire a one-shot sound. vol is a 0-1 multiplier on top of the key's trim and the master volume. */
export function playSfx(key, vol = 1) {
  if (muted || !SFX[key]) return;
  if (!oneShotCache[key]) {
    const a = new Audio(BASE + SFX[key]);
    a.preload = "auto";
    oneShotCache[key] = a;
  }
  const node = oneShotCache[key].cloneNode(true);
  node.volume = gainFor(key, vol);
  node.play().catch(() => {}); // ignore autoplay-policy rejections
}

/**
 * Build (but don't play) the Audio element for one or more keys, so the
 * browser starts fetching the file before the moment it's first needed.
 *
 * Every one of these five used to be an uncompressed WAV, 2-3.7 MB apiece, and
 * playSfx()/startLoop() only ever build an element on first play — so the
 * storm-out clip downloaded mid-night, the first time a patron actually gave
 * up, and the clone was asked to play before it had buffered. Converting them
 * to OGG (same settings as every other file here) shrank the download; this
 * is the other half — call it once, early, rather than let the first real use
 * be the first fetch.
 */
export function preload(...keys) {
  for (const key of keys) {
    if (SFX[key] && !oneShotCache[key]) {
      const a = new Audio(BASE + SFX[key]);
      a.preload = "auto";
      oneShotCache[key] = a;
    } else if (LOOPS[key] && !loopState[key]) {
      const el = new Audio(BASE + LOOPS[key]);
      el.loop = true; el.preload = "auto";
      loopState[key] = { el, vol: 1, playing: false };
    }
  }
}

/** Start a looped bed/QTE loop. Safe to call repeatedly — no-ops if already playing. */
export function startLoop(key, vol = 1) {
  if (!LOOPS[key]) return;
  let st = loopState[key];
  if (!st) {
    const el = new Audio(BASE + LOOPS[key]);
    el.loop = true; el.preload = "auto";
    st = loopState[key] = { el, vol, playing: false };
  }
  st.vol = vol;
  st.el.volume = muted ? 0 : gainFor(key, vol);
  if (!st.playing) {
    st.el.currentTime = 0;
    st.el.play().catch(() => {});
    st.playing = true;
  }
}

/** Stop a loop, optionally fading out over fadeSec instead of cutting hard. */
export function stopLoop(key, fadeSec = 0) {
  const st = loopState[key];
  if (!st || !st.playing) return;
  if (fadeSec <= 0) { st.el.pause(); st.playing = false; return; }
  const startVol = st.el.volume;
  const steps = 12;
  let i = 0;
  const iv = setInterval(() => {
    i++;
    st.el.volume = Math.max(0, startVol * (1 - i / steps));
    if (i >= steps) {
      clearInterval(iv);
      st.el.pause();
      st.el.volume = startVol; // restore so a later startLoop() isn't silent
      st.playing = false;
    }
  }, (fadeSec * 1000) / steps);
}

export function isLoopPlaying(key) { return !!loopState[key]?.playing; }

/** Global mute toggle — silences future one-shots and live loops alike. */
export function setMuted(v) {
  muted = v;
  for (const key in loopState) {
    const st = loopState[key];
    if (st.playing) st.el.volume = muted ? 0 : gainFor(key, st.vol);
  }
}
export function isMuted() { return muted; }

export function setMasterVolume(v) {
  masterVol = clamp01(v);
  for (const key in loopState) {
    const st = loopState[key];
    if (st.playing) st.el.volume = muted ? 0 : gainFor(key, st.vol);
  }
}
