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

let masterVol = 0.8;
let muted = false;

const oneShotCache = {};   // key -> template Audio element (cloned on play)
const loopState = {};      // key -> { el, vol, playing }

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** Fire a one-shot sound. vol is a 0-1 multiplier on top of master volume. */
export function playSfx(key, vol = 1) {
  if (muted || !SFX[key]) return;
  if (!oneShotCache[key]) {
    const a = new Audio(BASE + SFX[key]);
    a.preload = "auto";
    oneShotCache[key] = a;
  }
  const node = oneShotCache[key].cloneNode(true);
  node.volume = clamp01(vol * masterVol);
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
      loopState[key] = { el, vol: 0.5, playing: false };
    }
  }
}

/** Start a looped bed/QTE loop. Safe to call repeatedly — no-ops if already playing. */
export function startLoop(key, vol = 0.5) {
  if (!LOOPS[key]) return;
  let st = loopState[key];
  if (!st) {
    const el = new Audio(BASE + LOOPS[key]);
    el.loop = true; el.preload = "auto";
    st = loopState[key] = { el, vol, playing: false };
  }
  st.vol = vol;
  st.el.volume = muted ? 0 : clamp01(vol * masterVol);
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
    if (st.playing) st.el.volume = muted ? 0 : clamp01(st.vol * masterVol);
  }
}
export function isMuted() { return muted; }

export function setMasterVolume(v) {
  masterVol = clamp01(v);
  for (const key in loopState) {
    const st = loopState[key];
    if (st.playing) st.el.volume = muted ? 0 : clamp01(st.vol * masterVol);
  }
}
