// Removes every generated top-level entry before a rebuild so renamed or
// deleted source pages can never leave stale published files behind.
// This manifest must match test/smoke.mjs's GENERATED list.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const GENERATED = [
  "index.html",
  "sitemap.xml",
  "search",
  "new-to-numina",
  "lore",
  "mechanics",
  "css",
  "js",
  "fonts",
  "assets",
  "pagefind",
];

for (const entry of GENERATED) {
  await rm(join(root, entry), { recursive: true, force: true });
}
console.log(`clean: removed ${GENERATED.length} generated entries`);
