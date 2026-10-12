// loudness.mjs: ITU-R BS.1770 loudness of decoded PCM, in plain Node. No
// dependency, no decoder: it is handed Float32 channels and a sample rate.
// tools/measure-audio.mjs is what decodes the files and calls it.
//
// Three numbers come back for a clip:
//   integrated  gated programme loudness (LUFS), null under 400 ms of audio
//   momentary   the loudest 400 ms window (LUFS). A clip shorter than 400 ms
//               is measured as it sits in 400 ms of silence, which is how a
//               20 ms click is heard: the ear sums over a few hundred ms.
//   peak        sample peak (dBFS), not true peak
// A mono file is counted as playing from both speakers, which is what an
// <audio> element does with it, so mono and stereo files compare as heard.

function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// The K-weighting pair, rebuilt for the file's own sample rate (the standard
// prints coefficients for 48 kHz only).
export function kWeight(x, fs) {
  let K = Math.tan(Math.PI * 1681.974450955533 / fs);
  const Q1 = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q1 + K * K;
  const shelved = biquad(x, (Vh + Vb * K / Q1 + K * K) / a0, 2 * (K * K - Vh) / a0,
    (Vh - Vb * K / Q1 + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q1 + K * K) / a0);
  K = Math.tan(Math.PI * 38.13547087602444 / fs);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  return biquad(shelved, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0);
}

const lufs = (ms) => ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;

/** channels: array of Float32Array, all one length. */
export function measure(channels, fs) {
  const n = channels[0].length;
  const weight = channels.length === 1 ? 2 : 1;
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }

  // running sum of K-weighted power over every channel
  const cum = new Float64Array(n + 1);
  for (const ch of channels) {
    const k = kWeight(ch, fs);
    let s = 0;
    for (let i = 0; i < n; i++) { s += k[i] * k[i] * weight; cum[i + 1] += s; }
  }
  const win = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const blocks = [];
  if (n <= win) blocks.push(cum[n] / win);
  else for (let s = 0; s + win <= n; s += hop) blocks.push((cum[s + win] - cum[s]) / win);

  let integrated = null;
  if (n >= win) {
    const abs = blocks.filter((b) => lufs(b) > -70);
    if (abs.length) {
      const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const kept = abs.filter((b) => lufs(b) > rel);
      integrated = lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
    }
  }
  return {
    seconds: n / fs,
    channels: channels.length,
    integrated,
    momentary: lufs(Math.max(...blocks)),
    peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
  };
}
