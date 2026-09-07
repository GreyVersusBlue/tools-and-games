// make-textures.mjs — generate the 1k texture tier from the 2k originals.
//
//   npm i --no-save sharp          (from this folder; node_modules/ is ignored)
//   node tools/make-textures.mjs   [--force] [--only <key>]
//
// Reads every file js/textures.js's MATS names, resizes it to 1024×1024 with a
// Lanczos-3 kernel, and writes textures/<key>/1k/<slug>_<map>_1k.jpg beside it.
// A file whose 1k copy is newer than its 2k source is skipped unless --force.
// Output is an artifact checked into the repo (locked #17, #19): nothing here
// runs at page load, and the page never fetches anything but the files this
// wrote.
//
// Why JPEG, and why two chroma settings (Phase 4, measured 2026-09-07 on a
// 1024² Lanczos reference of each file, RMSE per channel over 0..255):
//
//   painted_plaster_wall_nor_gl   JPEG q88 4:2:0   190 KB   R 6.92  G 5.40  B 4.32
//                                 JPEG q88 4:4:4   363 KB   R 5.11  G 4.72  B 3.45
//                                 WebP q88         276 KB   R 5.86  G 3.98  B 4.05
//   brushed_concrete_nor_gl       JPEG q88 4:2:0   187 KB   R 6.01  G 4.58  B 3.48
//                                 JPEG q88 4:4:4   349 KB   R 4.15  G 3.87  B 2.51
//                                 WebP q88         240 KB   R 5.25  G 3.69  B 3.36
//   wood_floor_deck_diff          JPEG q88 4:2:0   246 KB   R 5.03  G 3.50  B 5.23
//                                 WebP q88         284 KB   R 4.22  G 2.65  B 4.91
//
// A normal map's tangent is its R and G channels, and 4:2:0 subsampling stores
// those at half resolution — that is what "normal maps as JPEG where it shows"
// was. 4:4:4 at the same quality takes the R error from 6.9 to 5.1 for twice
// the bytes, and twice 190 KB is still a twentieth of the 4,048 KB the 2k
// file weighs. WebP was not a clear win on either axis, and would have been a
// second format in the README's table. KTX2 was not measured: it needs a
// vendored KTX2Loader, the basis transcoder and its wasm (about 700 KB before
// the first texture), a worker, and an encoder this session did not have
// offline — see HISTORY.md, locked decision #202.
//
// Colour maps (diff, albedo) and the packed arm / rough maps keep 4:2:0 at q85:
// the arm map's channels are AO, roughness and metalness, none of which has an
// edge a texel wide, and the wood grain's colour survives subsampling at an
// RMSE the table above shows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { MATS, texturePath } from "../js/textures.js";

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require("sharp"); }
catch { console.error("sharp is not installed. From Projects/fourth-quarter:  npm i --no-save sharp"); process.exit(2); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const SIZE = 1024;
const encodeFor = slot => slot === "normal"
  ? { quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }
  : { quality: 85, mozjpeg: true, chromaSubsampling: "4:2:0" };

let wrote = 0, skipped = 0, inBytes = 0, outBytes = 0;
for (const [key, def] of Object.entries(MATS)) {
  if (only && key !== only) continue;
  for (const [slot, file] of Object.entries(def.files)) {
    const src = path.join(ROOT, texturePath(key, file, "2k"));
    const dst = path.join(ROOT, texturePath(key, file, "1k"));
    if (!fs.existsSync(src)) { console.error(`missing source: ${src}`); process.exit(1); }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const srcStat = fs.statSync(src);
    inBytes += srcStat.size;
    if (!force && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= srcStat.mtimeMs) {
      skipped++; outBytes += fs.statSync(dst).size; continue;
    }
    const buf = await sharp(src).resize(SIZE, SIZE, { kernel: "lanczos3" }).jpeg(encodeFor(slot)).toBuffer();
    fs.writeFileSync(dst, buf);
    wrote++; outBytes += buf.length;
    console.log(`${String(buf.length).padStart(8)}  ${path.relative(ROOT, dst)}  (${slot}, from ${srcStat.size})`);
  }
}
console.log(`\n${wrote} written, ${skipped} up to date. 2k set ${inBytes.toLocaleString()} bytes → 1k set ${outBytes.toLocaleString()} bytes (${(inBytes / outBytes).toFixed(1)}×).`);
