// smoke-textures.mjs — node test/smoke-textures.mjs
// The texture registry and its tiers, under bare Node. Two kinds of check:
// (1) every file MATS names exists on disk at every tier — the 1k set is a
// generated artifact (tools/make-textures.mjs) and a surface it forgot would
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
    }
  }
}
// The whole point of the phase: the default tier is an order of magnitude
// lighter than the originals. 10× is the bar the wishlist set; 13.6× shipped.
ok(bytes["1k"] * 10 <= bytes["2k"], `the 1k set is at least 10× lighter than 2k (${bytes["1k"]} vs ${bytes["2k"]} bytes, ${(bytes["2k"] / bytes["1k"]).toFixed(1)}×)`);
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
