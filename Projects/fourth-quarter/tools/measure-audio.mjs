// measure-audio.mjs: node tools/measure-audio.mjs [--scratch <dir>] [--check]
//
// Measures every file js/audio.js plays and writes audio/levels.json: the
// file's SHA-256, its length, and its loudness by tools/loudness.mjs. Run it
// by hand after adding or replacing a sound; test/smoke-mix.mjs fails until
// you have, because it compares each file's hash with the one written here.
//
// It needs a decoder on the machine and Node has none: `ffmpeg` if it is on
// the PATH, otherwise GStreamer's `gst-launch-1.0`. CI has neither and does
// not run this. That is why the measurements are a committed file and the
// suite pins them by hash instead of decoding. The decoded WAVs go in the
// scratch folder (the OS temp folder unless --scratch names one) and are
// deleted afterwards. --check measures and compares without writing, and
// exits 1 on a difference over 0.05 dB.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { files } from "../js/audio.js";
import { measure } from "./loudness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "audio", "levels.json");
const args = process.argv.slice(2);
const check = args.includes("--check");
const scratchArg = args.includes("--scratch") ? args[args.indexOf("--scratch") + 1] : null;

const has = (cmd, flag) => spawnSync(cmd, [flag], { stdio: "ignore" }).status === 0;
const decoder = has("ffmpeg", "-version") ? "ffmpeg" : has("gst-launch-1.0", "--version") ? "gst-launch-1.0" : null;
if (!decoder) { console.error("FAIL: no decoder. Install ffmpeg or GStreamer, or run this where one is."); process.exit(1); }

function decode(src, wav) {
  if (decoder === "ffmpeg") execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-c:a", "pcm_f32le", wav]);
  else execFileSync("gst-launch-1.0", ["-q", "filesrc", `location=${src}`, "!", "decodebin", "!", "audioconvert", "!",
    "audio/x-raw,format=F32LE", "!", "wavenc", "!", "filesink", `location=${wav}`]);
}

export function readWav(buf) {
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("latin1", p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), fs: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    // a streamed WAV carries a length of 0 or 0xFFFFFFFF: take what is there
    if (id === "data") { data = buf.subarray(p + 8, len && len !== 0xFFFFFFFF ? Math.min(buf.length, p + 8 + len) : buf.length); break; }
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data || fmt.bits !== 32) throw new Error("not a 32-bit float WAV");
  const n = Math.floor(data.length / 4 / fmt.ch);
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) channels[c][i] = data.readFloatLE((i * fmt.ch + c) * 4);
  return { fs: fmt.fs, channels };
}

const r2 = (v) => v === null ? null : Math.round(v * 100) / 100;
const scratch = mkdtempSync(join(scratchArg || tmpdir(), "fq-audio-"));
const out = {};
try {
  const seen = new Set();
  for (const { file } of Object.values(files())) {
    if (seen.has(file)) continue;
    seen.add(file);
    const src = join(ROOT, file), wav = join(scratch, "clip.wav");
    decode(src, wav);
    const { fs, channels } = readWav(readFileSync(wav));
    const m = measure(channels, fs);
    out[file] = {
      sha256: createHash("sha256").update(readFileSync(src)).digest("hex"),
      seconds: r2(m.seconds), channels: m.channels, rate: fs,
      integrated: r2(m.integrated), momentary: r2(m.momentary), peak: r2(m.peak),
    };
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
if (check) {
  const was = JSON.parse(readFileSync(OUT, "utf8")).files;
  let bad = 0;
  for (const k of new Set([...Object.keys(was), ...Object.keys(sorted)])) {
    const a = was[k], b = sorted[k];
    const off = !a || !b || a.sha256 !== b.sha256 || ["integrated", "momentary", "peak"].some((f) => Math.abs((a[f] ?? 0) - (b[f] ?? 0)) > 0.05);
    if (off) { bad++; console.error("FAIL:", k, JSON.stringify(a), "measured now", JSON.stringify(b)); }
  }
  console.log(bad ? `${bad} of ${Object.keys(sorted).length} files differ from audio/levels.json (${decoder})` : `${Object.keys(sorted).length} files match audio/levels.json (${decoder})`);
  process.exit(bad ? 1 : 0);
}
const doc = {
  what: "Loudness of every file js/audio.js plays, written by tools/measure-audio.mjs. LUFS by ITU-R BS.1770 (tools/loudness.mjs): integrated is the gated programme loudness and is null under 400 ms, momentary is the loudest 400 ms, peak is the sample peak in dBFS. A mono file is counted on both speakers. test/smoke-mix.mjs reads this and fails if a file's hash is not the one here.",
  decoder,
  files: sorted,
};
writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote audio/levels.json: ${Object.keys(sorted).length} files, decoded by ${decoder}`);
