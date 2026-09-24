// smoke-textures.mjs — node test/smoke-textures.mjs
// The texture registry and its tiers, under bare Node. Two kinds of check:
// (1) every file MATS names exists on disk at every tier — both sets are
// generated artifacts (Tools/board-check/asset-pipeline.mjs) and a surface it forgot would
// paint flat in the room with no test red; (2) pickTier() is the one rule for
// which tier a device downloads, so its cases are pinned here rather than
// discovered on somebody's phone.

import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MATS, TIERS, DEFAULT_TIER, textureFiles, texturePath, pickTier } from "../js/textures.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- the registry ---
const files = textureFiles();
ok(Object.keys(MATS).length === 9, `nine surfaces (got ${Object.keys(MATS).length})`);
ok(files.length === 27, `27 files across them (got ${files.length})`);
ok(files.every(f => /_2k\.jpg$/.test(f.file)), "every registry filename is a Poly Haven 2K name");
ok(TIERS.includes(DEFAULT_TIER), "the default tier is a tier on disk");
ok(TIERS[TIERS.length - 1] === "2k", "2k is the largest tier, and the registry's own filename");

// A JPEG's width and height, from its first start-of-frame marker. Bare Node
// has no image decoder and this suite takes no dependency; the header is
// enough to say whether a file is the size its tier claims.
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
const EDGE = { "1k": 1024, "2k": 2048 };

// --- (1) every file, every tier, on disk and non-trivial ---
let bytes = {};
for (const tier of TIERS) {
  bytes[tier] = 0;
  for (const { key, file } of files) {
    const p = join(ROOT, texturePath(key, file, tier));
    const there = existsSync(p);
    ok(there, `${tier}: ${texturePath(key, file, tier)} exists`);
    if (there) {
      const size = statSync(p).size;
      bytes[tier] += size;
      ok(size > 1024, `${tier}: ${file} is not an empty or truncated file (${size} bytes)`);
      const head = readFileSync(p).subarray(0, 3);
      ok(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, `${tier}: ${file} starts with a JPEG SOI marker`);
      // The 2k set is re-encoded by Tools/board-check/asset-pipeline.mjs, whose
      // --check measures its error against the originals at the output's own
      // size. A 2k file quietly written at 1024 would measure clean there, so
      // the size is pinned here, where CI runs it.
      const dim = jpegSize(readFileSync(p));
      ok(dim && dim.w === EDGE[tier] && dim.h === EDGE[tier], `${tier}: ${file} is ${EDGE[tier]} square (got ${dim ? dim.w + "x" + dim.h : "no SOF"})`);
    }
  }
}
// Phase 4 held the 1k set to a tenth of the 2k one, and shipped 13.6×, but the
// 2k files were Poly Haven's downloads at a quality near 100 then. The asset
// pipeline re-encoded them at q88 (#622): 69,218,191 bytes to 22,965,335, so
// the gap is now what four times the pixels costs at one quality, 4.5×. The
// two ceilings are what hold: 2k under 24 MB, so the downloads cannot come
// back, and 1k at least 4× lighter, so the default tier is still worth having.
ok(bytes["2k"] < 24_000_000, `the 2k set is under 24,000,000 bytes, the pipeline's re-encode (${bytes["2k"]} bytes)`);
ok(bytes["1k"] * 4 <= bytes["2k"], `the 1k set is at least 4× lighter than 2k (${bytes["1k"]} vs ${bytes["2k"]} bytes, ${(bytes["2k"] / bytes["1k"]).toFixed(1)}×)`);
ok(bytes["1k"] < 8 * 1024 * 1024, `the 1k set is under 8 MB (${bytes["1k"]} bytes)`);

// --- paths ---
ok(texturePath("floorWood", "wood_floor_deck_diff_2k.jpg", "2k") === "textures/floorWood/wood_floor_deck_diff_2k.jpg", "2k path is the registry name in the surface's folder");
ok(texturePath("floorWood", "wood_floor_deck_diff_2k.jpg", "1k") === "textures/floorWood/1k/wood_floor_deck_diff_1k.jpg", "1k path is the 1k folder and Poly Haven's 1K name");
ok(texturePath("leather", "brown_leather_albedo_2k.jpg", "1k") === "textures/leather/1k/brown_leather_albedo_1k.jpg", "the albedo quirk survives the tier rename");
ok(texturePath("floorWood", "wood_floor_deck_diff_2k.jpg") === texturePath("floorWood", "wood_floor_deck_diff_2k.jpg", DEFAULT_TIER), "no tier means the default tier");
let threw = false; try { texturePath("floorWood", "wood_floor_deck_diff_2k.jpg", "4k"); } catch { threw = true; }
ok(threw, "a tier that is not on disk throws rather than fetching a 404");
threw = false; try { texturePath("floorWood", "wood_floor_deck.jpg", "1k"); } catch { threw = true; }
ok(threw, "a filename without _2k in it cannot be retiered");

// --- (2) pickTier() ---
const retina = { dpr: 2, maxTextureSize: 16384, widthPx: 2880 };
ok(pickTier() === "1k", "no facts at all → 1k");
ok(pickTier({}) === "1k", "an empty environment → 1k");
ok(pickTier({ dpr: 1, maxTextureSize: 16384, widthPx: 1920 }) === "1k", "a 1080p desktop at dpr 1 → 1k");
ok(pickTier(retina) === "2k", "a Retina laptop (dpr 2, 16k textures, 2880 px wide) → 2k");
ok(pickTier({ ...retina, dpr: 1.5 }) === "1k", "dpr 1.5 is not enough for 2k");
ok(pickTier({ ...retina, maxTextureSize: 4096 }) === "1k", "a GPU capped at 4096 → 1k, whatever the screen");
ok(pickTier({ ...retina, widthPx: 2048 }) === "1k", "a 2048 px backing store → 1k");
ok(pickTier({ dpr: 3, maxTextureSize: 8192, widthPx: 1170 }) === "1k", "a phone at dpr 3 with a 1170 px backing store → 1k");
ok(pickTier({ ...retina, saveData: true }) === "1k", "saveData forces 1k on a Retina laptop");
ok(pickTier({ ...retina, override: "1k" }) === "1k", "?tex=1k wins over a Retina laptop");
ok(pickTier({ dpr: 1, maxTextureSize: 4096, override: "2k" }) === "2k", "?tex=2k wins over a small GPU");
ok(pickTier({ ...retina, saveData: true, override: "2k" }) === "2k", "the override wins over saveData too — it is the person asking");
ok(pickTier({ ...retina, override: "4k" }) === "2k", "an override naming no tier on disk is ignored");
ok(pickTier({ dpr: NaN, maxTextureSize: NaN, widthPx: NaN }) === "1k", "NaN facts → 1k, not a throw");
ok(pickTier({ dpr: undefined, maxTextureSize: undefined }) === "1k", "undefined facts → 1k");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
