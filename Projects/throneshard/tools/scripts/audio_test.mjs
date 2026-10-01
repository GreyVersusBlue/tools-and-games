// Audio smoke test (WS4): unlocks WebAudio via a real click, checks that all sample files decode, exercises hero
// voices (12 heroes + an unknown hero fallback), attack flavours and every announcer line; renders the formant
// announcer offline to a spectrogram PNG (/tmp/ws4/spectrogram.png). Usage: node scripts/audio_test.mjs <url>
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForSelector('.btn-play', { timeout: 180000 });
await p.mouse.click(1000, 600); // user gesture -> unlock
await p.click('.btn-play');
await p.waitForSelector('.pk-card[data-id="brakka"]');
await p.click('.pk-card[data-id="brakka"]');
await p.click('.btn-lock');
await p.waitForFunction(() => window.game?.running, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  const a = game.audio;
  const out = { state: a.ctx?.state };
  const files = [...a.buffers.entries()];
  out.decoded = files.filter(([, v]) => v instanceof AudioBuffer).length;
  out.failed = files.filter(([k, v]) => v === null && !/music|ambience/.test(k)).map(([k]) => k);
  const played = {};
  const heroes = Object.values(game.heroDefs);
  for (const def of heroes) {
    const u = { heroId: def.id, def, kind: 'hero', position: game.player.hero.position };
    const ha = a.heroAudio(u);
    a.lastPlay.clear();
    const fresh = () => { a.lastPlay.clear(); a.voices.length = 0; };
    const res = {};
    for (const cat of ['cast', 'ult', 'death']) { fresh(); res[cat] = !!a.voice(u, cat, { volume: 0.05 }); }
    played[def.id] = { voice: ha.voice, attack: ha.attack, ...res };
  }
  const unknown = { heroId: 'storm_witch', def: { id: 'storm_witch', name: 'Storm Witch', attackType: 'ranged', primary: 'int', projectileKind: 'storm_witch' }, kind: 'hero' };
  out.unknown = a.heroAudio(unknown);
  a.lastPlay.clear(); a.voices.length = 0;
  out.unknownCast = !!a.voice(unknown, 'ult');
  out.heroes = played;
  for (const l of ['first_blood', 'double_kill', 'massacre', 'mythic', 'tower_destroyed', 'tower_lost', 'grimmaw_ours']) a.announce(l);
  // offline render of the formant voice -> spectrogram
  const SR = 22050;
  const lines = ['first_blood', 'double_kill', 'killing_spree', 'mythic'];
  const off = new OfflineAudioContext(1, SR * 7, SR);
  const nb = off.createBuffer(1, SR * 2, SR); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const fake = { ctx: off, buses: { voice: off.destination }, reverbSend: off.createGain(), _noise: nb, settings: { muted: false } };
  let t = 0.05;
  for (const l of lines) { const v = a.speak.call(fake, l, t); t += v.dur + 0.25; }
  const buf = await off.startRendering();
  const x = buf.getChannelData(0);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  // spectrogram (naive DFT on 256-sample frames, 0-5 kHz)
  const N = 512, hop = 128, frames = Math.floor((SR * t - N) / hop), bins = 116;
  const cv = document.createElement('canvas'); cv.width = frames; cv.height = bins * 2;
  const c = cv.getContext('2d'); const img = c.createImageData(frames, bins * 2);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N); const s = x[f * hop + n] * w; const ph = (2 * Math.PI * k * n) / N; re += s * Math.cos(ph); im -= s * Math.sin(ph); }
      const db = 20 * Math.log10(Math.hypot(re, im) + 1e-6);
      const v = Math.max(0, Math.min(255, (db + 30) * 4));
      for (const yy of [0, 1]) { const i = ((bins * 2 - 1 - (k * 2 + yy)) * frames + f) * 4; img.data[i] = v; img.data[i + 1] = v * 0.8; img.data[i + 2] = 255 - v * 0.5; img.data[i + 3] = 255; }
    }
  }
  c.putImageData(img, 0, 0);
  out.spec = cv.toDataURL('image/png');
  out.speakPeak = +peak.toFixed(3);
  out.speakDur = +t.toFixed(2);
  return out;
});
const fs = await import('fs');
fs.writeFileSync('/tmp/ws4/spectrogram.png', Buffer.from(r.spec.split(',')[1], 'base64'));
delete r.spec;
await p.waitForTimeout(6000);
console.log(JSON.stringify(r, null, 1));
const uniq = [...new Set(errs)];
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 30).join('\n'));
await b.close();
