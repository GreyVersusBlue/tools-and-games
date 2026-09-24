// asset-pipeline.mjs — the one offline pipeline for the site's heavy games (#619).
//
//   npm i --no-save @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 \
//                   @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0 sharp@0.35.4
//   node asset-pipeline.mjs                  # list the recipes
//   node asset-pipeline.mjs <recipe>         # build it, write the outputs
//   node asset-pipeline.mjs <recipe> --dry   # build it, report, write nothing
//   node asset-pipeline.mjs <recipe> --check # texture recipes: measure what is
//                                            # committed against the originals
//
// The mesh recipes need the first four packages and the texture recipes need
// sharp; each kind only loads what it uses.
//
// Run from Tools/board-check/. The packages are dev-only and deliberately not in
// package.json: CI never runs this, and `npm ci` there should not pull a glTF
// toolchain to check links. What this writes is an ordinary file checked into
// the project that uses it, and the page never runs anything here (#17: nothing
// shared across projects at runtime). A recipe whose output needs a decoder in
// the browser names it, and the decoder is vendored inside that project, never
// under assets/.
//
// SOURCES COME FROM GIT, NOT FROM DISK. Each recipe names the commit its
// originals were last committed at and reads them with `git show`, because the
// point of a recipe is that its originals get deleted. Re-running one after
// that still works, and still produces the same bytes.
//
// WHY MESHOPT AND NOT DRACO (measured 2026-09-24 on Bell to Bell's Casual_2, a
// 3,058,092-byte embedded .gltf that gzips to 491,010):
//
//                                       raw        gzip    decoder in browser
//   the Idle clip only, as .glb     619,468     172,645    none
//     + KHR_mesh_quantization       393,516     133,137    none (core GLTFLoader)
//     + EXT_meshopt_compression     189,628     118,224    24,850 B, no worker
//   Draco                                 —           —    285,747 B wasm + 58,763 B
//                                                          wrapper + a worker, and
//                                                          it compresses geometry only
//
// The host could not be asked whether it gzips .gltf (the sandbox's proxy 403s
// the live site), and .glb is binary, which hosts serve as it is. So the rule a
// recipe has to meet is the one that holds either way: an output's RAW size must
// be under its source's GZIPPED size. Meshopt clears it with 2.6x to spare;
// plain .glb does not (619 KB against 491 KB), which is why converting to .glb
// alone would have been a regression on a host that compresses JSON. This
// script exits non-zero if any output misses that rule. The one exception is a
// texture re-encoded at its own size that misses it: that job keeps its source
// byte for byte instead, since the re-encode would be bigger and worse (#622).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);

// --- recipes ----------------------------------------------------------------
//
// A recipe is a list of { from, to } pairs, repo-relative, the commit `from`
// is read at, and the steps. Add a game by adding a recipe, not a script.

const B2B_CHAR = "Projects/bell-to-bell/Assets/models";
const MEN = `${B2B_CHAR}/Ultimate Modular Men/Ultimate Modular Men- Feb 2022/Individual Characters/glTF`;
const WOMEN = `${B2B_CHAR}/Ultimate Modular Women/Ultimate Modular Women - April 2022/Individual Characters/glTF`;
const outfit = (dir, name) => ({ from: `${dir}/${name}.gltf`, to: `${dir}/${name}.glb` });

export const RECIPES = {
  // Bell to Bell's eight rigged students. Each shipped as an embedded .gltf
  // with 24 animation clips; src/world/models.js poseIdle() samples the first
  // clip matching /idle/i, which in all eight is "Idle", at 1.2 s, and never
  // plays anything else. The materials are flat colours with no textures, and
  // prune() drops TEXCOORD_0 by itself when no texture reads it.
  "bell-to-bell-characters": {
    rev: "afbcae94b844578972457e3c678c620fd1a7f488",
    pairs: [
      outfit(MEN, "Casual_2"),
      outfit(WOMEN, "Casual"),
      outfit(MEN, "Worker"),
      outfit(WOMEN, "Formal"),
      outfit(MEN, "Adventurer"),
      outfit(WOMEN, "Worker"),
      outfit(MEN, "Casual_Hoodie"),
      outfit(WOMEN, "Adventurer")
    ],
    keepClips: ["Idle"],
    meshopt: "high",
    decoder: "Projects/bell-to-bell/libs/addons/libs/meshopt_decoder.module.js"
  }
};

// --- texture recipes --------------------------------------------------------
//
// A texture recipe is a jobs(rev) function instead of a list of pairs, because
// its files are named by the project's own registry and the jobs are derived
// from it. Each job is { from, to, width, slot, enc }: `from` read at `rev`,
// resized to `width` (null keeps it) with Lanczos-3, encoded by `enc`, and
// written to `to`. A job whose `to` is its `from` re-encodes a file in place,
// which is why the originals have to come from git: running the recipe twice
// from disk would re-encode its own output and lose a generation each time.
// `texts` are small text files the recipe rewrites (a .gltf whose image URIs
// name the new files).
//
// THE ERROR RULE. A texture can get smaller and uglier at once, and a byte
// count cannot tell that from a win. So every output is decoded and measured
// against the original resized to the output's size with the same kernel,
// per channel RMSE over 0..255, and the worst channel of any file has to stay
// under the recipe's `ceiling` or the run exits 1. `--check` does the same to
// what is committed and adds a tighter rule: it encodes each file the recipe's
// way too, and fails a committed file whose worst channel is more than
// CHECK_SLACK worse than that. The ceiling alone was too loose to hold a q88
// recipe: the clipboard's colour map read 3.11 at q88, and 5.77 at q60 and
// 6.38 at q50, so a ceiling of 6 caught q50 and let q60 through. Against the
// recipe's own 3.11 + 0.5, q80's 4.03 fails. A different sharp build may
// encode a few bytes differently; it will not move a channel by half a unit.
// `--check` also fails a file whose dimensions are not the recipe's: a 2k file
// quietly downscaled to 1k measures clean against a 1k reference, so the size
// is pinned separately.
//
// Why these encodings (the RMSE columns are R/G/B, measured 2026-09-24 with
// sharp 0.35.4, mozjpeg, against a Lanczos-3 reference at the output size):
//
//   Poly Haven's 1k JPEGs are 4:2:0 at a quality near 100; the clipboard's
//   diffuse map is 572,026 bytes for 1024x1024. At q88 the same pixels are
//   114,547 bytes at an RMSE of 2.9/2.7/3.0. Most of this increment is that.
//
//   The packed arm map (AO, roughness, metalness) is data, not colour, and on
//   a prop it has edges a texel wide: the clipboard's metal clip against the
//   board. At 512, 4:2:0 subsampling put the metalness channel at 13.0 RMSE
//   (41,775 B); 4:4:4 put it at 3.4 (68,245 B). The fire alarm's arm map: 10.6
//   against 2.8. So every non-colour map is 4:4:4, the rule Fourth Quarter's
//   normals already followed (its 1k table is below).
//
//   A colour map on a hand-sized prop at 512 is 4:4:4 too: the fire alarm's
//   red body at 4:2:0 was 5.1/3.3/3.6, at 4:4:4 3.1/2.8/3.0, for 50 KB against
//   69 KB. A colour map at 1024 and up on a surface that tiles across a room
//   stays 4:2:0, where Fourth Quarter measured the grain surviving it.
//
//   Fourth Quarter's 1k tier (Phase 4, measured 2026-09-07 on a 1024-square
//   Lanczos reference, RMSE per channel):
//
//     painted_plaster_wall_nor_gl   JPEG q88 4:2:0   190 KB   R 6.92  G 5.40  B 4.32
//                                   JPEG q88 4:4:4   363 KB   R 5.11  G 4.72  B 3.45
//                                   WebP q88         276 KB   R 5.86  G 3.98  B 4.05
//     brushed_concrete_nor_gl       JPEG q88 4:2:0   187 KB   R 6.01  G 4.58  B 3.48
//                                   JPEG q88 4:4:4   349 KB   R 4.15  G 3.87  B 2.51
//                                   WebP q88         240 KB   R 5.25  G 3.69  B 3.36
//     wood_floor_deck_diff          JPEG q88 4:2:0   246 KB   R 5.03  G 3.50  B 5.23
//                                   WebP q88         284 KB   R 4.22  G 2.65  B 4.91
//
//   WebP was not a clear win on either axis there and would be a second format
//   in each project's loader; KTX2 needs a vendored transcoder of about 700 KB
//   before the first texture (#202). JPEG stays.

const CHECK_SLACK = 0.5;
const jpeg = (quality, chromaSubsampling) => ({ quality, mozjpeg: true, chromaSubsampling });
const slotOf = file =>
  /_nor_gl_/.test(file) ? "normal" : /_(diff|albedo)_/.test(file) ? "colour" : "data";

function readJSONAt(rev, file) { return JSON.parse(gitShow(rev, file).toString("utf8")); }

// Bell to Bell. The six props a hand could cover go to 512: a fire alarm
// 14 cm wide 2.15 m up, a wall clock 32 cm across, and four things on the
// teacher's desk, the largest a 24 x 32 cm clipboard, seen from an eye height of
// 1.65 m over a 0.78 m desk. At 512 the clipboard's face still gets about as
// many texels as it covers pixels at 1080p from a metre away. Everything else
// (the room's seven tiled surfaces, which fill the screen, the plants, the
// shelves, the rack, the sign and the picture frame) keeps its 1024 and is
// re-encoded at q88. There is no tier picker (#621): the page loads one set.
const B2B = "Projects/bell-to-bell";
const B2B_SMALL = new Set(["wallClock", "fireAlarm", "clipboard", "stationery", "binder", "stapler"]);
const b2bEnc = (slot, width) =>
  slot === "colour" && width !== 512 ? jpeg(88, "4:2:0") : jpeg(88, "4:4:4");

async function bellToBellJobs(rev) {
  const manifest = readJSONAt(rev, `${B2B}/data/assets.json`);
  const jobs = [], texts = [];
  const job = (file, width) => {
    const slot = slotOf(file);
    const to = width === 512 ? file.replace(/_1k\.jpg$/, "_512.jpg") : file;
    jobs.push({ from: file, to, width, slot, enc: b2bEnc(slot, width) });
    return to;
  };
  for (const { dir, base, packedArm = true } of Object.values(manifest.textures)) {
    for (const map of ["diff", "nor_gl", packedArm ? "arm" : "rough"]) job(`${B2B}/${dir}/${base}_${map}_1k.jpg`, null);
  }
  const models = [...Object.entries(manifest.props), ["frame", manifest.art.frame]];
  for (const [key, gltf] of models) {
    const file = `${B2B}/${gltf}`;
    const text = gitShow(rev, file).toString("utf8");
    const dir = path.posix.dirname(file);
    let out = text;
    for (const { uri } of JSON.parse(text).images || []) {
      const to = job(path.posix.join(dir, decodeURIComponent(uri)), B2B_SMALL.has(key) ? 512 : null);
      const toUri = path.posix.relative(dir, to);
      if (toUri !== uri) out = out.split(JSON.stringify(uri)).join(JSON.stringify(toUri));
    }
    if (out !== text) texts.push({ from: file, to: file, text: out });
  }
  return { jobs, texts };
}

// Fourth Quarter. Both tiers come from the Poly Haven 2K originals as
// downloaded. The 2k tier is re-encoded in place at the same size, which is
// what #202 left for later (66 MiB, and only a Retina-class device loads it,
// #201). The 1k tier used to be tools/make-textures.mjs reading the 2k files
// off disk; once the 2k files are re-encoded that would compound two lossy
// passes, so it is this recipe now, reading the same originals from git. Run
// with sharp 0.35.4 it rewrites all 27 of the committed 1k files byte for byte.
const FQ = "Projects/fourth-quarter";
const fqEnc = (slot, tier) =>
  slot === "normal" ? jpeg(88, "4:4:4") : jpeg(tier === "2k" ? 88 : 85, "4:2:0");

async function fourthQuarterJobs() {
  const url = pathToFileURL(path.join(REPO, FQ, "js/textures.js")).href;
  const { textureFiles, texturePath, TIERS } = await import(url);
  const jobs = [];
  for (const { key, slot, file } of textureFiles()) {
    const from = `${FQ}/${texturePath(key, file, "2k")}`;
    for (const tier of TIERS) {
      const to = `${FQ}/${texturePath(key, file, tier)}`;
      jobs.push({ from, to, width: tier === "2k" ? null : 1024, slot: slotOf(file), enc: fqEnc(slot, tier) });
    }
  }
  return { jobs, texts: [] };
}

Object.assign(RECIPES, {
  "bell-to-bell-textures": { kind: "textures", rev: "24b6b99d0d14d772d8bf29a8977cd58279ce6ff9", jobs: bellToBellJobs, ceiling: 6 },
  "fourth-quarter-textures": { kind: "textures", rev: "24b6b99d0d14d772d8bf29a8977cd58279ce6ff9", jobs: fourthQuarterJobs, ceiling: 9 }
});

// --- toolchain --------------------------------------------------------------

function need(name) {
  try { return require(name); }
  catch {
    console.error(`${name} is not installed. From Tools/board-check:\n` +
      "  npm i --no-save @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 " +
      "@gltf-transform/functions@4.5.0 meshoptimizer@1.2.0 sharp@0.35.4");
    process.exit(2);
  }
}

function gitShow(rev, file) {
  // execFileSync, not a shell: the Ultimate Modular folders have spaces in
  // their names and Windows is the dev machine.
  return execFileSync("git", ["show", `${rev}:${file}`], { cwd: REPO, maxBuffer: 256 << 20 });
}

const gz = buf => zlib.gzipSync(buf, { level: 6 }).byteLength;
const kb = n => (n / 1024).toFixed(0).padStart(6) + " KB";

// --- the steps --------------------------------------------------------------

async function build(recipe, src, io, fns, encoder) {
  const json = JSON.parse(src.toString("utf8"));
  const doc = await io.readJSON({ json, resources: {} });
  const root = doc.getRoot();

  if (recipe.keepClips) {
    const keep = new Set(recipe.keepClips);
    const present = root.listAnimations().map(a => a.getName());
    for (const k of keep) {
      if (!present.includes(k)) throw new Error(`no clip named ${k} (has ${present.join(", ")})`);
    }
    // Animation.dispose() leaves its samplers alive, and a live sampler keeps
    // its two accessors "in use" as far as prune() can tell. Disposing only the
    // animation kept 2,770 of 2,780 accessors and made the output 518 KB
    // instead of 190. Channels and samplers have to go by hand.
    for (const a of root.listAnimations()) {
      if (keep.has(a.getName())) continue;
      for (const c of a.listChannels()) c.dispose();
      for (const s of a.listSamplers()) s.dispose();
      a.dispose();
    }
  }

  const steps = [fns.prune(), fns.dedup(), fns.resample()];
  if (recipe.meshopt) steps.push(fns.meshopt({ encoder, level: recipe.meshopt }));
  await doc.transform(...steps);

  // Survives a decode: the same clips, the same number of meshes and skins.
  return { doc, clips: root.listAnimations().map(a => a.getName()) };
}

// --- textures ---------------------------------------------------------------

// Per-channel RMSE of `out` against `ref`, both raw pixel buffers of the same
// size and channel count, over 0..255. Returns the worst channel and all three.
function rmse(ref, out, channels) {
  const sum = new Float64Array(channels);
  for (let i = 0; i < ref.length; i++) { const d = ref[i] - out[i]; sum[i % channels] += d * d; }
  const per = [...sum].map(x => Math.sqrt(x / (ref.length / channels)));
  return { worst: Math.max(...per), per };
}

async function runTextures(name, recipe, { dry, check }) {
  const sharp = need("sharp");
  const { jobs, texts } = await recipe.jobs(recipe.rev);
  const problems = [];
  let before = 0, after = 0, worstAll = 0, nKept = 0;
  const srcCache = new Map();
  console.log(`${name} (sources at ${recipe.rev.slice(0, 7)}, ceiling ${recipe.ceiling} RMSE)` +
    (check ? ", checking what is committed" : "") + "\n");

  for (const j of jobs) {
    if (!srcCache.has(j.from)) srcCache.set(j.from, gitShow(recipe.rev, j.from));
    const src = srcCache.get(j.from);
    const meta = await sharp(src).metadata();
    const w = j.width || meta.width, h = Math.round(meta.height * w / meta.width);
    const resized = () => w === meta.width ? sharp(src) : sharp(src).resize(w, h, { kernel: "lanczos3" });

    // A file already small enough that re-encoding it misses the byte rule is
    // kept as it came, byte for byte, when the job keeps its size. Ten of
    // Bell to Bell's did on the first run: Poly Haven's smaller props ship
    // JPEGs that gzip by up to 40%, and 4:4:4 at q88 came out bigger than that.
    const sg = gz(src);
    let out, kept = false;
    if (check) {
      const disk = path.join(REPO, j.to);
      if (!fs.existsSync(disk)) { problems.push(`${j.to}: missing`); continue; }
      out = fs.readFileSync(disk);
      kept = j.to === j.from && out.equals(src);
    } else {
      out = await resized().jpeg(j.enc).toBuffer();
      if (out.length >= sg && j.to === j.from && w === meta.width) { out = src; kept = true; }
    }

    const got = await sharp(out).metadata();
    if (got.width !== w || got.height !== h) {
      problems.push(`${j.to}: ${got.width}x${got.height}, the recipe makes ${w}x${h}`);
      continue;
    }
    const ref = await resized().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const dec = await sharp(out).removeAlpha().raw().toBuffer();
    const e = rmse(ref.data, dec, ref.info.channels);
    worstAll = Math.max(worstAll, e.worst);
    if (e.worst > recipe.ceiling) {
      problems.push(`${j.to}: RMSE ${e.per.map(x => x.toFixed(2)).join("/")} is over the ceiling of ${recipe.ceiling}`);
    } else if (check && !kept) {
      const fresh = await resized().jpeg(j.enc).toBuffer();
      const want = rmse(ref.data, await sharp(fresh).removeAlpha().raw().toBuffer(), ref.info.channels).worst;
      if (e.worst > want + CHECK_SLACK) {
        problems.push(`${j.to}: worst channel RMSE ${e.worst.toFixed(2)} against the recipe's own ` +
          `${want.toFixed(2)}, more than ${CHECK_SLACK} worse`);
      }
    }
    if (!kept && out.length >= sg) problems.push(`${j.to}: ${out.length} bytes is not under the source's ${sg} gzipped`);
    after += out.length;
    if (kept) nKept++;
    console.log(`  ${path.basename(j.to).padEnd(44)} ${j.slot.padEnd(6)} ${String(w).padStart(4)}  ` +
      `${kb(src.length)} -> ${kb(out.length)}  ` +
      (kept ? "kept as it came" : `RMSE ${e.per.map(x => x.toFixed(2).padStart(5)).join(" ")}`));
    if (!dry && !check && !kept) {
      fs.mkdirSync(path.dirname(path.join(REPO, j.to)), { recursive: true });
      fs.writeFileSync(path.join(REPO, j.to), out);
    }
  }

  for (const t of texts) {
    const disk = path.join(REPO, t.to);
    if (check) {
      if (!fs.existsSync(disk) || fs.readFileSync(disk, "utf8") !== t.text) problems.push(`${t.to}: not what the recipe writes`);
    } else if (!dry) {
      fs.writeFileSync(disk, t.text);
    }
    console.log(`  ${path.basename(t.to)}: image URIs rewritten`);
  }

  for (const b of srcCache.values()) before += b.length;
  console.log(`\n  ${jobs.length} textures (${nKept} kept as they came) from ${srcCache.size} originals, ` +
    `${before} bytes -> ${after} bytes (${(before / after).toFixed(1)}x), ` +
    `worst channel RMSE ${worstAll.toFixed(2)}`);
  if (dry) console.log("  --dry: nothing written");
  if (check) console.log("  --check: nothing written");
  return problems;
}

async function main() {
  const [name, ...flags] = process.argv.slice(2);
  const dry = flags.includes("--dry"), check = flags.includes("--check");
  if (!name || !RECIPES[name]) {
    console.log("recipes:\n" + Object.keys(RECIPES).map(k => "  " + k).join("\n"));
    process.exit(name ? 1 : 0);
  }
  const recipe = RECIPES[name];
  if (recipe.kind === "textures") {
    const problems = await runTextures(name, recipe, { dry, check });
    if (problems.length) {
      console.log("\n" + problems.length + " PROBLEMS");
      for (const p of problems) console.log("  " + p);
      process.exit(1);
    }
    return;
  }
  if (check) { console.error("--check is for texture recipes; characters.mjs checks the meshes"); process.exit(1); }

  const { NodeIO } = need("@gltf-transform/core");
  const { ALL_EXTENSIONS } = need("@gltf-transform/extensions");
  const fns = need("@gltf-transform/functions");
  const { MeshoptEncoder, MeshoptDecoder } = need("meshoptimizer");
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

  if (recipe.decoder && !fs.existsSync(path.join(REPO, recipe.decoder))) {
    console.error(`${name} needs its decoder vendored first: ${recipe.decoder}`);
    process.exit(1);
  }

  const problems = [];
  let before = 0, beforeGz = 0, after = 0, afterGz = 0;
  console.log(`${name} (sources at ${recipe.rev.slice(0, 7)})\n`);
  for (const { from, to } of recipe.pairs) {
    const src = gitShow(recipe.rev, from);
    const { doc, clips } = await build(recipe, src, io, fns, MeshoptEncoder);
    const out = Buffer.from(await io.writeBinary(doc));

    // Read it back the way a browser would have to: through the decoder.
    const back = await io.readBinary(new Uint8Array(out));
    const backClips = back.getRoot().listAnimations().map(a => a.getName());
    if (backClips.join() !== clips.join()) problems.push(`${to}: clips changed on decode`);

    const s = src.length, sg = gz(src), o = out.length, og = gz(out);
    before += s; beforeGz += sg; after += o; afterGz += og;
    if (o >= sg) problems.push(`${to}: ${o} bytes raw is not under the source's ${sg} gzipped`);
    console.log(`  ${path.basename(path.dirname(path.dirname(path.dirname(from)))).slice(0, 22).padEnd(22)} ` +
      `${path.basename(to).padEnd(18)} ${kb(s)} (gz ${kb(sg)}) -> ${kb(o)} (gz ${kb(og)})`);
    if (!dry) fs.writeFileSync(path.join(REPO, to), out);
  }
  console.log(`\n  total ${before} bytes (gz ${beforeGz}) -> ${after} bytes (gz ${afterGz}), ` +
    `${(before / after).toFixed(1)}x raw, ${(beforeGz / afterGz).toFixed(1)}x gzipped`);
  if (dry) console.log("  --dry: nothing written");

  if (problems.length) {
    console.log("\n" + problems.length + " PROBLEMS");
    for (const p of problems) console.log("  " + p);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
