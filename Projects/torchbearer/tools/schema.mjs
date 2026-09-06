#!/usr/bin/env node
// tools/schema.mjs — write packs/schema.json from js/schema.js, or check it.
//
// The contract has one source, js/schema.js, because the engine imports it and
// the engine must not depend on a fetch to boot. packs/schema.json is that
// document on disk so an author, a JSON editor or any other tool can point at a
// file. The file is generated rather than typed, and test/smoke.mjs runs the
// same comparison this does, so the two cannot drift.
//
//   node tools/schema.mjs           # check; exits 1 and prints a diff if stale
//   node tools/schema.mjs --write   # regenerate
//
// A check that only prints is a check that gets ignored (locked #13), so the
// default mode is the one that exits non-zero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCHEMA } from "../js/schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "packs", "schema.json");

/** The exact bytes packs/schema.json is supposed to hold. */
export function serialize() {
  return JSON.stringify(SCHEMA, null, 2) + "\n";
}

/** null when the file is current, or a one-line reason when it is not. */
export function staleReason() {
  let onDisk;
  try { onDisk = fs.readFileSync(OUT, "utf8"); }
  catch (e) { return `packs/schema.json is missing (${e.code}).`; }
  const want = serialize();
  if (onDisk === want) return null;
  // Say where, not just that. A 900-line diff nobody reads is the same as no
  // message at all.
  const a = onDisk.split("\n"), b = want.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  if (at === -1) return `packs/schema.json has ${a.length} lines, js/schema.js makes ${b.length}.`;
  return `packs/schema.json line ${at + 1} is ${JSON.stringify(a[at] ?? null)}, js/schema.js makes ${JSON.stringify(b[at] ?? null)}.`;
}

// Windows is the dev machine, and a bare C:\... path is read by Node as URL
// scheme "c:" and refused outright, so the entry-point test goes through
// pathToFileURL rather than comparing strings.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (process.argv.includes("--write")) {
    fs.writeFileSync(OUT, serialize());
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${serialize().length} bytes)`);
  } else {
    const why = staleReason();
    if (why) {
      console.error(`packs/schema.json is out of date with js/schema.js.\n  ${why}\n  Fix it with: node tools/schema.mjs --write`);
      process.exit(1);
    }
    console.log("packs/schema.json matches js/schema.js.");
  }
}
