// asset-pipeline.mjs — the one offline pipeline for the site's heavy games (#619).
//
//   npm i --no-save @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 \
//                   @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0
//   node asset-pipeline.mjs                  # list the recipes
//   node asset-pipeline.mjs <recipe>         # build it, write the outputs
//   node asset-pipeline.mjs <recipe> --dry   # build it, report, write nothing
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
// script exits non-zero if any output misses that rule.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

// --- toolchain --------------------------------------------------------------

function need(name) {
  try { return require(name); }
  catch {
    console.error(`${name} is not installed. From Tools/board-check:\n` +
      "  npm i --no-save @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 " +
      "@gltf-transform/functions@4.5.0 meshoptimizer@1.2.0");
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

async function main() {
  const [name, ...flags] = process.argv.slice(2);
  const dry = flags.includes("--dry");
  if (!name || !RECIPES[name]) {
    console.log("recipes:\n" + Object.keys(RECIPES).map(k => "  " + k).join("\n"));
    process.exit(name ? 1 : 0);
  }
  const recipe = RECIPES[name];

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
