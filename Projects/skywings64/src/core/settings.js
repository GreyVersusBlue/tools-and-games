// Persistent user settings. Exposed read-only as window.SW_SETTINGS (frozen snapshot, live getter) and
// window.SW_QUALITY ('low'|'medium'|'high'). Every change fires a 'settingsChanged' CustomEvent on window
// with detail = { key, value, settings }.
const KEY = 'skywings64.settings.v1';

export const DEFAULTS = Object.freeze({
  quality: 'high',       // 'low' | 'medium' | 'high'
  master: 0.8,           // 0..1
  music: 0.8,            // 0..1
  sfx: 0.8,              // 0..1
  shake: 1,              // camera shake amount 0..1
  invertPitch: false,
  units: 'metric',       // 'metric' (km/h, m) | 'imperial' (mph, ft) | 'aviation' (kt, ft)
  cinematic: false,      // include cinematic camera-cut mode in the C-key camera cycle
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SANITIZE = {
  quality: (v) => (['low', 'medium', 'high'].includes(v) ? v : 'high'),
  master: (v) => clamp01(+v || 0), music: (v) => clamp01(+v || 0), sfx: (v) => clamp01(+v || 0), shake: (v) => clamp01(+v || 0),
  invertPitch: (v) => !!v, cinematic: (v) => !!v,
  units: (v) => (['metric', 'imperial', 'aviation'].includes(v) ? v : 'metric'),
};

let current = { ...DEFAULTS };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s === 'object') for (const k in DEFAULTS) if (k in s) current[k] = SANITIZE[k](s[k]);
} catch (e) { /* ignore */ }
// ?quality=low|medium|high overrides for this page load only (testing / weak devices); not persisted.
try {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && ['low', 'medium', 'high'].includes(q)) current.quality = q;
} catch (e) { /* ignore */ }
let snapshot = Object.freeze({ ...current });

function install() {
  if (typeof window === 'undefined') return;
  try {
    Object.defineProperty(window, 'SW_SETTINGS', { configurable: true, enumerable: true, get: () => snapshot, set: () => {} });
    Object.defineProperty(window, 'SW_QUALITY', { configurable: true, enumerable: true, get: () => snapshot.quality, set: () => {} });
  } catch (e) { /* ignore */ }
}
install();

export function getSettings() { return snapshot; }

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  const v = SANITIZE[key](value);
  if (current[key] === v) return;
  current[key] = v;
  snapshot = Object.freeze({ ...current });
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) { /* ignore */ }
  applyAudio();
  try { window.dispatchEvent(new CustomEvent('settingsChanged', { detail: { key, value: v, settings: snapshot } })); } catch (e) { /* ignore */ }
}

export function resetSettings() {
  for (const k in DEFAULTS) setSetting(k, DEFAULTS[k]);
}

// Push volumes into the AudioManager (exposed by main.js as window.__game.audio) whenever it exists.
export function applyAudio() {
  try {
    const a = window.__game && window.__game.audio;
    if (!a) return false;
    const s = snapshot;
    a.setVolume && a.setVolume(s.master);
    a.setMusicVolume && a.setMusicVolume(s.music * 0.625);
    a.setSfxVolume && a.setSfxVolume(Math.min(1, s.sfx * 1.125));
    return !!a.master;
  } catch (e) { return false; }
}
// audio is created after main.js boots and its context after a user gesture: retry for a while.
if (typeof window !== 'undefined') {
  let tries = 0;
  const iv = setInterval(() => { if ((applyAudio() && tries > 2) || ++tries > 120) clearInterval(iv); }, 1000);
  window.addEventListener('pointerdown', () => setTimeout(applyAudio, 50), { passive: true });
  window.addEventListener('keydown', () => setTimeout(applyAudio, 50), { passive: true, once: true });
}

// unit helpers used by the HUD
export const UNITS = {
  metric: { speed: 3.6, speedLabel: 'KM/H', alt: 1, altLabel: 'M', vs: 1, vsLabel: 'M/S', dist: 1 },
  imperial: { speed: 2.23694, speedLabel: 'MPH', alt: 3.28084, altLabel: 'FT', vs: 3.28084, vsLabel: 'FT/S', dist: 3.28084 },
  aviation: { speed: 1.94384, speedLabel: 'KT', alt: 3.28084, altLabel: 'FT', vs: 196.85, vsLabel: 'FPM', dist: 1 },
};
