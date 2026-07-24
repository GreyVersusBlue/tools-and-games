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
  stormOut:       "sfx/events/patron-storm-out.wav",
  stingerKickoff: "sfx/events/stinger-kickoff.wav",
  stingerFinal:   "sfx/events/stinger-final-whistle.wav",
};

const LOOPS = {
  barBed: "ambience/bar-bed-crowded-pub-loop.ogg",
  sizzle: "sfx/qte/qte-sizzle-loop.wav",
  pour:   "sfx/qte/qte-pour-loop.wav",
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
