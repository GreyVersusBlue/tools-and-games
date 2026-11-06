// smoke-mix.mjs — node test/smoke-mix.mjs [--table]
//
// The mix (#942): how loud each sound is once js/audio.js has played it, and
// whether each role is still in its band. No DOM, no decoder.
//
// A sound's level here is its file's loudness (audio/levels.json, measured by
// tools/measure-audio.mjs) plus the gain audio.js sets on the element, which
// this file asks audio.js for (gainFor) and also reads off a stubbed Audio
// element, plus the multiplier each call site in js/ passes, which this file
// reads out of the source. One-shots are compared by their loudest 400 ms and
// loops by their gated programme loudness, both LUFS by ITU-R BS.1770.
//
// What it cannot do is decode: Node has no Vorbis or MP3 decoder and CI has no
// ffmpeg. So the file loudness is a committed measurement and what holds it to
// the file is the SHA-256 beside it. Replace a sound and this suite is red
// until tools/measure-audio.mjs has been run where a decoder is.
//
// Nobody has listened to the mix these bands describe. The bands are the
// arithmetic of #942, not a judgement that it sounds right; that is Devon's.
// --table prints the README's before-and-after table.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "../tools/loudness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const dB = (g) => 20 * Math.log10(g);
const f1 = (v) => (v < 0 ? "" : "+") + v.toFixed(1);

// ---- the meter itself, against the standard's own reference tone ----
// BS.1770: a 997 Hz sine at -23 dBFS in both channels reads -23.0 LUFS.
{
  const fs = 48000, n = fs * 5, amp = Math.pow(10, -23 / 20);
  const tone = Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * 997 * i / fs));
  const st = measure([tone, tone], fs);
  ok(Math.abs(st.integrated + 23) < 0.05 && Math.abs(st.momentary + 23) < 0.05, `a 997 Hz tone at -23 dBFS in stereo reads -23.0 LUFS (${st.integrated.toFixed(2)})`);
  ok(Math.abs(st.peak + 23) < 0.01, "and peaks at -23.0 dBFS");
  ok(Math.abs(measure([tone], fs).integrated + 23) < 0.05, "a mono file is counted on both speakers, so the same tone in mono reads the same");
  const at = (hz) => { const t = Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / fs)); return measure([t, t], fs).integrated + 23; };
  ok(Math.abs(at(4000) - 3.28) < 0.1 && Math.abs(at(50) + 4.63) < 0.1 && at(25) < -10, `the K-weighting is on: the same tone reads 3.3 dB higher at 4 kHz and 4.6 lower at 50 Hz (${at(4000).toFixed(2)}, ${at(50).toFixed(2)})`);
  const click = new Float32Array(480).fill(amp);
  ok(measure([click, click], fs).integrated === null && measure([click, click], fs).momentary < -40, "a 10 ms clip has no programme loudness and is weighed inside 400 ms");
  const half = Float32Array.from(tone, (v, i) => i < n / 2 ? v : 0);
  ok(Math.abs(measure([half, half], fs).integrated + 23) < 0.3, "the gate drops the silent half of a clip instead of averaging it in");
}

// ---- audio.js, played into a stub ----
const made = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; this.volume = 1; this.loop = false; made.push(this); }
  cloneNode() { const c = new globalThis.Audio(this.src); c.clone = true; return c; }
  play() { this.played = true; return Promise.resolve(); }
  pause() { this.played = false; }
};
const audio = await import("../js/audio.js");
const FILES = audio.files();
const KEYS = Object.keys(FILES);

ok(KEYS.length === 18, `audio.js plays 18 sounds (${KEYS.length})`);
ok(KEYS.every((k) => typeof audio.TRIM[k] === "number" && audio.TRIM[k] > 0 && audio.TRIM[k] <= 1), "every one has a trim over 0 and no more than 1: " + KEYS.filter((k) => !(audio.TRIM[k] > 0 && audio.TRIM[k] <= 1)).join(" "));
ok(Object.keys(audio.TRIM).every((k) => FILES[k]), "and the trim table names no sound that is not there: " + Object.keys(audio.TRIM).filter((k) => !FILES[k]).join(" "));
ok(audio.MASTER === 0.8, "the master volume is 0.8, as it was");
ok(audio.gainFor("orderDing") === audio.TRIM.orderDing * audio.MASTER && audio.gainFor("cashRegister", 0.7) === 0.7 * audio.TRIM.cashRegister * audio.MASTER, "gainFor is the trim, the master and the call site's number multiplied");
ok(audio.gainFor("orderDing", 50) === 1 && audio.gainFor("orderDing", -1) === 0, "and is held between 0 and 1");
for (const key of KEYS.filter((k) => !FILES[k].loop)) {
  made.length = 0;
  audio.playSfx(key);
  const node = made.find((a) => a.clone);
  ok(node && node.played && node.volume === audio.gainFor(key) && node.src === FILES[key].file, `playSfx("${key}") plays ${FILES[key].file} at its trimmed volume`);
}
for (const key of KEYS.filter((k) => FILES[k].loop)) {
  made.length = 0;
  audio.startLoop(key);
  const el = made[0];
  ok(el && el.loop && el.played && el.volume === audio.gainFor(key), `startLoop("${key}") loops at its trimmed volume`);
  audio.setMuted(true);
  const silent = el && el.volume === 0;
  audio.setMuted(false);
  ok(silent && el.volume === audio.gainFor(key), `and "${key}" comes back from a mute at the same volume`);
  audio.setMasterVolume(0.4);
  const halved = el && Math.abs(el.volume - audio.gainFor(key) ) < 1e-12 && Math.abs(el.volume - audio.TRIM[key] * 0.4) < 1e-12;
  audio.setMasterVolume(audio.MASTER);
  ok(halved, `and "${key}" follows the master volume`);
  audio.stopLoop(key);
}
{
  made.length = 0;
  audio.setMuted(true); audio.playSfx("orderDing"); audio.setMuted(false);
  ok(made.every((a) => !a.played), "a muted one-shot is not played");
}

// ---- the call sites: which keys the game fires, and what each passes ----
const calls = []; // { key, vol, fn, where }
const badCalls = [];
for (const name of readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js") && f !== "audio.js")) {
  const src = readFileSync(join(ROOT, "js", name), "utf8");
  const re = /audio\.(playSfx|startLoop)\(/g;
  for (let m; (m = re.exec(src));) {
    let depth = 1, i = re.lastIndex;
    while (depth && i < src.length) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; }
    const argText = src.slice(re.lastIndex, i - 1);
    const where = `${name}:${src.slice(0, m.index).split("\n").length}`;
    // a key is any quoted word that is not the right-hand side of a comparison
    const keys = [...argText.replace(/[!=]==?\s*"\w+"/g, "").matchAll(/"(\w+)"/g)].map((x) => x[1]);
    const tail = argText.slice(argText.lastIndexOf('"') + 1).trim();
    const vol = tail === "" ? 1 : /^,\s*\d*\.?\d+$/.test(tail) ? Number(tail.slice(1)) : NaN;
    if (!keys.length || keys.some((k) => !FILES[k]) || Number.isNaN(vol)) badCalls.push(`${where} (${argText})`);
    for (const key of keys) calls.push({ key, vol, fn: m[1], where });
  }
}
ok(badCalls.length === 0, "every playSfx and startLoop call in js/ names its sounds and its volume in plain literals: " + badCalls.join("; "));
ok(calls.length >= 20, `${calls.length} calls read out of js/`);
// The two footsteps are played by audio.playStep(), which picks the take, so a
// call site names neither. What is pinned for them is that main.js calls it.
const STEPS = ["footstepA", "footstepB"];
const stepCalls = readFileSync(join(ROOT, "js", "main.js"), "utf8").match(/audio\.playStep\(\s*f\.vol\s*\)/g) || [];
ok(KEYS.every((k) => STEPS.includes(k) || calls.some((c) => c.key === k)), "every sound audio.js has is played somewhere: " + KEYS.filter((k) => !STEPS.includes(k) && !calls.some((c) => c.key === k)).join(" "));
ok(stepCalls.length === 1 && !calls.some((c) => STEPS.includes(c.key)), "and the footsteps are played from one place, main.js's audio.playStep(f.vol), which walk.js's Footfalls feeds");
ok(calls.every((c) => (c.fn === "startLoop") === FILES[c.key]?.loop), "loops are started and one-shots are fired, never the other way round");
ok(calls.every((c) => c.vol <= 1), "no call site turns a sound up past its trim");
const quieter = calls.filter((c) => c.vol !== 1);
ok(quieter.length === 1 && quieter[0].key === "cashRegister" && quieter[0].vol === 0.7 && quieter[0].where.startsWith("patrons.js"), "one call passes a number of its own: the staff's cash register at 0.7 (" + quieter.map((c) => `${c.where} ${c.key} ${c.vol}`).join("; ") + ")");

// ---- the measurements, held to the files by hash ----
const LEVELS = JSON.parse(readFileSync(join(ROOT, "audio", "levels.json"), "utf8")).files;
const onDisk = [];
(function walk(dir) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.(ogg|mp3|wav|m4a|flac)$/i.test(f)) onDisk.push(p);
  }
})("audio");
const played = KEYS.map((k) => FILES[k].file);
ok(onDisk.every((p) => played.includes(p)) && played.every((p) => onDisk.includes(p)), "the files under audio/ are the files audio.js plays: " + [...onDisk.filter((p) => !played.includes(p)), ...played.filter((p) => !onDisk.includes(p))].join(" "));
ok(Object.keys(LEVELS).sort().join() === [...new Set(played)].sort().join(), "and audio/levels.json has a measurement for each and for nothing else");
for (const key of KEYS) {
  const file = FILES[key].file, L = LEVELS[file];
  if (!L) { ok(false, `${file} has no measurement`); continue; }
  const sha = createHash("sha256").update(readFileSync(join(ROOT, file))).digest("hex");
  ok(sha === L.sha256, `${file} is the file that was measured (run tools/measure-audio.mjs if it was replaced)`);
  ok(L.peak <= 0 && L.momentary < 0 && L.momentary > -45 && (L.seconds < 0.4 ? L.integrated === null : L.integrated <= L.momentary), `${file}'s numbers are a measurement's: peak ${L.peak}, loudest 400 ms ${L.momentary}`);
}

// ---- the table ----
// One row per sound per call-site volume. `level` is what the role is judged
// by: the loudest 400 ms for a one-shot, the programme loudness for a loop.
const ROLE = {
  orderDing: "cue", ticketReady: "cue", cashRegister: "cue", qteHit: "cue", qteMiss: "cue",
  stingerKickoff: "cue", stingerFinal: "cue",
  uiClick: "ui", uiOpen: "ui", uiClose: "ui",
  crowdGroan: "crowd", crowdCheer: "crowd", stormOut: "crowd", barBed: "bed",
  footstepA: "step", footstepB: "step",
  sizzle: "work", pour: "work",
};
// What played on 2026-10-07, when Devon said "Sound levels are a bit all over
// the place, crowd is loud": no trims, master 0.8, and these at the call site.
const HEARD = { barBed: 0.35, sizzle: 0.55, pour: 0.55 };
const OFTEN = {
  orderDing: "every order, and each event card", ticketReady: "every ticket the kitchen finishes", cashRegister: "every sale",
  qteHit: "a QTE landed", qteMiss: "a QTE missed", stingerKickoff: "once a night", stingerFinal: "once a night",
  uiClick: "buttons, mostly by day", uiOpen: "a panel opened", uiClose: "a panel closed",
  crowdGroan: "once, on a loss, with the whistle", crowdCheer: "once, on a win, with the whistle", stormOut: "every walkout, 13 s each, several at once on a bad night",
  footstepA: "a body in earshot takes a step, at most 3 at a time and 6 a second", footstepB: "the other take of the same step",
  barBed: "the whole night", sizzle: "while searing", pour: "while pouring",
};
const rows = [];
for (const key of KEYS) {
  const L = LEVELS[FILES[key].file];
  if (!L) continue;
  // a footstep has no call site of its own: it is judged at its loudest, vol 1
  for (const vol of STEPS.includes(key) ? [1] : [...new Set(calls.filter((c) => c.key === key).map((c) => c.vol))].sort((a, b) => b - a)) {
    const gain = audio.gainFor(key, vol), was = vol * (HEARD[key] ?? 1) * 0.8;
    const fileLevel = FILES[key].loop ? L.integrated : L.momentary;
    rows.push({ key, vol, role: key === "cashRegister" && vol < 1 ? "cue, staff" : ROLE[key], loop: FILES[key].loop, file: FILES[key].file, fileLevel, gain, was,
      level: fileLevel + dB(gain), before: fileLevel + dB(was), loudest: L.momentary + dB(gain), peak: Math.pow(10, L.peak / 20) * gain, peakBefore: Math.pow(10, L.peak / 20) * was });
  }
}
const row = (key) => rows.find((r) => r.key === key); // the loudest the key is played
ok(rows.length === 19 && KEYS.every((k) => ROLE[k]), `19 rows, a role for each of the 18 sounds and a second row for the staff's register (${rows.length})`);

// ---- the bands ----
const CUE = -26; // LUFS, the loudest 400 ms of a foreground one-shot at the master volume
const BAND = {
  cue: [CUE - 1.5, CUE + 1.5],          // heard at once, level with each other
  "cue, staff": [CUE - 4.5, CUE - 1.5], // the register when the staff ring it: it fires all night
  ui: [CUE - 5.5, CUE - 2.5],           // panels and buttons, under the game's own cues
  crowd: [CUE - 12, CUE - 6],           // a crowd reaction, clearly under a cue
  step: [CUE - 20, CUE - 15],           // a footfall, loudest 400 ms; the crowd's own feet, under the crowd
  work: [CUE - 21, CUE - 15],           // the sear and the pour, programme loudness
  bed: [CUE - 26, CUE - 22],            // the room, programme loudness
};
for (const r of rows) {
  const [lo, hi] = BAND[r.role] || [NaN, NaN];
  ok(r.level >= lo && r.level <= hi, `${r.key}${r.vol < 1 ? " at " + r.vol : ""} (${r.role}) is ${r.level.toFixed(1)} LUFS, inside ${lo} to ${hi}`);
}
const by = (role) => rows.filter((r) => r.role === role);
const spread = (rs) => Math.max(...rs.map((r) => r.level)) - Math.min(...rs.map((r) => r.level));
const spreadBefore = (rs) => Math.max(...rs.map((r) => r.before)) - Math.min(...rs.map((r) => r.before));
ok(spread(by("cue")) < 1.5, `the seven cues are within 1.5 dB of each other (${spread(by("cue")).toFixed(2)}; they were ${spreadBefore(by("cue")).toFixed(2)} apart)`);
ok(Math.abs(spreadBefore(by("cue")) - 19.55) < 0.05, "and 19.55 dB apart is what was heard on 2026-10-07");
ok(spread(by("ui")) < 1, `the three UI sounds are within 1 dB of each other (${spread(by("ui")).toFixed(2)})`);
ok(Math.max(...by("ui").map((r) => r.level)) < Math.min(...by("cue").map((r) => r.level)) - 2.5, "every UI sound is over 2.5 dB under every cue");
ok(Math.abs(row("sizzle").level - row("pour").level) < 3 && Math.abs(row("sizzle").loudest - row("pour").loudest) < 3.5, "the sear and the pour are within 3 dB of each other as programmes and 3.5 at their loudest");

// The crowd. Each of its three sounds is at least 12 dB under what was heard,
// and that is more than any frequent cue came down, so the crowd is lower
// against the order ding and the register as well as in itself.
const CROWD = ["barBed", "crowdGroan", "stormOut"];
for (const k of CROWD) ok(row(k).before - row(k).level >= 12, `${k} is ${(row(k).before - row(k).level).toFixed(1)} dB under what Devon heard, which is at least 12`);
ok(Math.abs(row("barBed").before - row("barBed").level - 12.82) < 0.01, "the bed is 12.8 dB down");
const cueDrop = (k) => row(k).before - row(k).level;
ok(["orderDing", "cashRegister", "ticketReady", "qteMiss"].every((k) => CROWD.every((c) => row(c).before - row(c).level > cueDrop(k) - 0.3)),
  "no crowd sound has gained on the order ding, the register, the ticket bell or a missed QTE (to 0.3 dB)");
ok(row("barBed").level <= row("sizzle").level - 4 && row("barBed").level <= row("pour").level - 4, `the bed is at least 4 dB under the sear and the pour (${(row("sizzle").level - row("barBed").level).toFixed(1)}, ${(row("pour").level - row("barBed").level).toFixed(1)})`);
ok(row("barBed").before > row("sizzle").before + 9, "where it had been 9 dB over the sear");
// Footsteps are left out: a step is meant to sit in the room, under the bed's
// loudest 400 ms and over its programme loudness (checked below).
const quietest = Math.min(...rows.filter((r) => !r.loop && r.role !== "step").map((r) => r.level));
ok(row("barBed").loudest <= quietest - 5, `the bed's loudest 400 ms (${row("barBed").loudest.toFixed(1)}) is at least 5 dB under the quietest one-shot that is not a step`);
const three = row("stormOut").level + 10 * Math.log10(3);
ok(three <= CUE - 5, `three walkouts sounding at once (${three.toFixed(1)}) are still 5 dB under a cue`);
ok(row("crowdGroan").level <= row("stingerFinal").level - 6, "the groan sits at least 6 dB under the whistle it plays with");
// The cheer (TG-36) came after the cut and was never heard, so it has no
// "before" to be 12 dB under. It stands in for the groan on a win, so it is
// held level with the groan, and under the whistle by the same margin.
{
  const cheer = row("crowdCheer") || { level: NaN, loudest: NaN }, groan = row("crowdGroan");
  ok(Math.abs(cheer.level - groan.level) <= 0.5, `the cheer (${cheer.level.toFixed(1)}) is level with the groan (${groan.level.toFixed(1)}), to 0.5 dB`);
  ok(cheer.loudest <= groan.loudest + 0.5, "and no louder than the groan at its loudest 400 ms");
  ok(cheer.level <= row("stingerFinal").level - 6, "the cheer sits at least 6 dB under the whistle it plays with");
}
// Which crowd sound answers the whistle. A cheer on a loss reads the same to
// every number above, so the call itself is pinned: one call in the final
// whistle's case, after the whistle, picking the cheer when the Mules won.
{
  const src = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  const final = src.slice(src.indexOf('case "final":'), src.indexOf("break;", src.indexOf('case "final":')));
  const answer = final.match(/audio\.playSfx\(([^)]*"crowd(?:Cheer|Groan)"[^)]*)\)/g) || [];
  ok(final.indexOf('audio.playSfx("stingerFinal")') >= 0 && answer.length === 1 && final.indexOf(answer[0]) > final.indexOf('audio.playSfx("stingerFinal")'),
    `the final whistle's case plays the whistle and then one crowd answer (${answer.join("; ") || "none"})`);
  ok(/^audio\.playSfx\(\s*e\.win\s*\?\s*"crowdCheer"\s*:\s*"crowdGroan"\s*\)$/.test(answer[0] || ""), "and that answer is the cheer when e.win and the groan when not");
  ok(calls.filter((c) => c.key === "crowdCheer" || c.key === "crowdGroan").every((c) => c.where.startsWith("main.js")) && calls.filter((c) => c.key === "crowdCheer").length === 1,
    "nothing else in js/ plays the cheer or the groan");
}

// The footsteps (TG-37), never heard. A boot on a board is 0.24 and 0.32 s
// long, so its loudest 400 ms is spread over silence and reads low; the band
// above is for that reading. What is pinned beyond the band: the two takes
// sit within 1 dB so the alternation is not a limp, and a step is under the
// walkout, the crowd sound it walks with, by at least 6 dB.
ok(Math.abs(row("footstepA").level - row("footstepB").level) < 1, `the two footstep takes are within 1 dB (${row("footstepA").level.toFixed(1)}, ${row("footstepB").level.toFixed(1)})`);
ok(Math.max(row("footstepA").level, row("footstepB").level) <= row("stormOut").level - 6, "and both are at least 6 dB under a walkout");
ok(row("footstepA").level > row("barBed").level && row("footstepA").level < row("barBed").loudest, `a step (${row("footstepA").level.toFixed(1)}) is over the bed's programme loudness (${row("barBed").level.toFixed(1)}) and under its loudest 400 ms (${row("barBed").loudest.toFixed(1)}): in the room, not on top of it`);
ok(audio.TRIM.footstepA <= 0.9 && audio.TRIM.footstepB <= 0.9, "neither take is at the top of its trim: there is room to turn them up");

// ---- headroom ----
// The sets below are what the code fires on one tick over what is already
// looping. The sum of their sample peaks is the most the output can reach.
const peakSum = (keys, f = "peak") => keys.reduce((s, k) => s + (typeof k === "string" ? (row(k) || {})[f] : k[1] * row(k[0])[f]), 0);
const TICK = {
  "kickoff, mid-sear": ["barBed", "sizzle", "stingerKickoff"],
  "the final whistle on a loss, mid-sear": ["barBed", "sizzle", "stingerFinal", "crowdGroan"],
  "the final whistle on a win, mid-sear": ["barBed", "sizzle", "stingerFinal", "crowdCheer"],
  "a QTE scored as its loop fades": ["barBed", "sizzle", "qteMiss"],
  "a ticket comes ready, mid-sear": ["barBed", "sizzle", "ticketReady"],
};
for (const [name, keys] of Object.entries(TICK)) ok(peakSum(keys) <= 1, `${name}: sample peaks sum to ${f1(dB(peakSum(keys)))} dBFS, under full scale`);
ok(peakSum(TICK["kickoff, mid-sear"], "peakBefore") > 1, "kickoff mid-sear went over full scale at the old gains");
// The loudest moment worth calling plausible: all of it at once.
const PILE = ["barBed", "sizzle", "stingerKickoff", ["stormOut", 3], "orderDing", "ticketReady", "cashRegister"];
const power = (f) => 10 * Math.log10(PILE.reduce((s, k) => { const [key, n] = typeof k === "string" ? [k, 1] : k; return s + n * Math.pow(10, (row(key).loudest + (f === "before" ? row(key).before - row(key).level : 0)) / 10); }, 0));
ok(power() <= -18, `bed, sear, kickoff, three walkouts, a ding, a bell and a sale at once are ${power().toFixed(1)} LUFS, under -18 (${power("before").toFixed(1)} before)`);
// Said out loud (#147): the sample-peak bound on that pile is over full
// scale. It needs nine one-sample peaks to land on the same sample; it was
// +12 dBFS before; and taking it under 0 would cost every sound another 6 dB.
// What is pinned is that it does not grow.
ok(dB(peakSum(PILE)) <= 6 && dB(peakSum(PILE, "peakBefore")) > 11.9, `the same pile's sample peaks sum to ${f1(dB(peakSum(PILE)))} dBFS (${f1(dB(peakSum(PILE, "peakBefore")))} before): over full scale only if nine peaks align`);

if (process.argv.includes("--table")) {
  console.log("\n| Sound | Role | Fires | File | File, LUFS | Peak, dBFS | Gain before | Heard before | Gain now | Now, LUFS | Change |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const NEW = ["crowdCheer", "footstepA", "footstepB"]; // added after 2026-10-07, so never heard at the old gains
  for (const r of rows) { const n = NEW.includes(r.key);
    console.log(`| \`${r.key}\`${r.vol < 1 ? " × " + r.vol : ""} | ${r.role} | ${OFTEN[r.key]}${r.vol < 1 ? ", by staff" : ""} | \`${r.file.replace("audio/", "")}\` | ${r.fileLevel.toFixed(1)}${r.loop ? " I" : ""} | ${LEVELS[r.file].peak.toFixed(1)} | ${n ? "new" : +r.was.toFixed(3)} | ${n ? "new" : r.before.toFixed(1)} | ${+r.gain.toFixed(3)} | ${r.level.toFixed(1)} | ${n ? "new" : f1(r.level - r.before) + " dB"} |`); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
