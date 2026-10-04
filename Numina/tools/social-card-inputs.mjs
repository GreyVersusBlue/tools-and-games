// What the social card is drawn from, as one hash.
//
// tools/social-card.mjs screenshots the real /lore/nations/ page, so the card
// takes its colours from the light theme's token block in src/css/main.css and
// its map from src/_includes/partials/world-map.njk. Change either and the
// committed src/assets/social-card.png is a picture of the old site until
// somebody runs `npm run card`. Nothing said so; this is what says so.
//
// The tool records the hash in tools/social-card.inputs.json each time it draws
// the card, and test/smoke.mjs fails when the hash of the files as they stand
// is not the recorded one. No browser here: this file is imported by `npm test`.
//
// What it cannot see: a rule outside the token block that restyles the map
// (.map-region and friends), a changed font file, or an edit to the card's own
// layout in social-card.mjs. Those still want a re-run by hand.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const numina = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD = join(numina, "tools", "social-card.inputs.json");
export const INPUTS = ["src/css/main.css (the first :root block)", "src/_includes/partials/world-map.njk"];

// \r\n folded to \n: Windows is the dev machine and a checkout with autocrlf on
// must hash the same as CI's.
const read = (rel) => readFileSync(join(numina, rel), "utf8").replace(/\r\n/g, "\n");

// The light theme is the first `:root {` in the file; the card forces
// data-theme="light", so the two dark blocks below it never reach the card.
export function lightTokens(css) {
  const m = css.match(/^:root \{\n[\s\S]*?\n\}/m);
  if (!m) throw new Error("no `:root {` block in src/css/main.css");
  return m[0];
}

export function cardInputsHash() {
  return createHash("sha256")
    .update(lightTokens(read("src/css/main.css")))
    .update("\0")
    .update(read("src/_includes/partials/world-map.njk"))
    .digest("hex");
}

export function recordedHash() {
  return JSON.parse(readFileSync(RECORD, "utf8")).sha256;
}
