#!/usr/bin/env node
// tools/export-walk.mjs — the house bundler for the walk export (Phase 23).
//
// The codebase has no build step, and this file does not add one to the
// *tool* — index.html still loads js/main.js as plain modules. What it adds
// is a way out: it walks the static import graph from js/walk-main.js,
// topologically sorts it, and rewrites the whole graph — the vendored
// three.js and its addons included — into one `<script type="module">` with
// no import or export statement left in it, spliced into tools/walk-shell.html
// and written to walk-template.html. The export button in the tool splices a
// design payload into that template and downloads it; `--design` here does
// the same from the command line.
//
// Why this is possible at all: twenty phases of "pure modules never import
// three.js" means the graph is a DAG of plain ES modules in one house style —
// no default exports, no re-exports, no `export let`, one declaration per
// export statement, imports at column 0. The transforms below are written
// against that discipline (and against the vendored three, which keeps its
// hundreds of exports in a single final `export { ... }` statement); anything
// outside it is a loud error here rather than a quiet miscompile, and the
// suite in test/export-walk.test.mjs re-bundles on every run so drift cannot
// land silently.
//
// How a module is rewritten: each becomes an IIFE returning its exports,
//
//   const __m_js_grid_js = (() => {
//     ...source, `export ` stripped...
//     return { CELL, EYE_H, ... };
//   })();
//
// and every import of it becomes a const destructure of that object
// (`import * as THREE from 'three'` → `const THREE = __m_libs_three_module_js;`).
// Evaluation order is the same depth-first postorder ES modules use, so an
// acyclic graph behaves identically; a cycle is an error, stated with its path.
//
// The budget, stated (the wishlist asked for it out loud): the template must
// stay under 4 MB — three.js is ~1.3 MB of it — so that a finished export
// (template + a generated school's ~50 KB payload, plus any imported models
// the design carries) passes through any chat client's file limit with room
// to spare. The suite enforces the number; the real targets are the other
// two: an exported file opens from file:// with zero network requests and
// zero console errors.
//
// Usage:
//   node tools/export-walk.mjs                    rebuild walk-template.html
//   node tools/export-walk.mjs --design d.json    also write walk.html with
//                                                 that design (or the sample
//                                                 school, with `sample`)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // .../tools
export const PROJECT = dirname(HERE);                   // .../school-generator

export const TEMPLATE_PATH = join(PROJECT, 'walk-template.html');
const SHELL_PATH = join(HERE, 'walk-shell.html');
const ENTRY = join(PROJECT, 'js', 'walk-main.js');

// The design marker, shared with the export button in main.js — the one
// string both sides have to agree on. Phase 27 adds a second on the same
// terms: the baked light rides its own slot, and a template whose bake
// marker is never spliced opens on live lighting.
export const DESIGN_MARKER = '<!--SG-DESIGN-->';
export const BAKE_MARKER = '<!--SG-BAKE-->';
const BUNDLE_MARKER = '<!--SG-BUNDLE-->';

// The stated ceiling for the committed template, bytes. See the header.
export const TEMPLATE_BUDGET = 4 * 1024 * 1024;

// ---------- resolving ----------

// The same three specifier forms index.html's import map serves, and no
// others: 'three', 'three/addons/…', and a relative path.
export function resolveSpec(spec, importerPath) {
  if (spec === 'three') return join(PROJECT, 'libs', 'three.module.js');
  if (spec.startsWith('three/addons/')) {
    return join(PROJECT, 'libs', 'addons', spec.slice('three/addons/'.length));
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return resolvePath(dirname(importerPath), spec);
  }
  throw new Error(`Unresolvable import specifier '${spec}' in ${importerPath}`);
}

const moduleId = (path) =>
  `__m_${relative(PROJECT, path).replace(/[^A-Za-z0-9]/g, '_')}`;

// ---------- parsing one module ----------
//
// Regex against the house style, not a JS parser — see the header for why
// that is safe here. Every pattern anchors at column 0, which no string or
// indented comment in this codebase puts an `import`/`export` at.

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[^\S\n]*$/gm;
const BARE_IMPORT_RE = /^import\s+['"]([^'"]+)['"];?[^\S\n]*$/gm;
const EXPORT_LIST_RE = /^export\s*\{([\s\S]*?)\}\s*;?[^\S\n]*$/gm;
const EXPORT_DECL_RE = /^export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gm;
const EXPORT_NAME_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm;

export function parseModule(source, path) {
  for (const bad of [/^export\s+default\b/m, /^export\s*\{[^}]*\}\s*from\b/m, /^export\s+\*\s+from\b/m]) {
    if (bad.test(source)) {
      throw new Error(`${path}: uses an export form the house bundler refuses (default or re-export)`);
    }
  }

  const imports = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    imports.push({ clause: m[1].trim(), spec: m[2] });
  }
  for (const m of source.matchAll(BARE_IMPORT_RE)) {
    imports.push({ clause: null, spec: m[1] });
  }

  // Exported names: declarations first, then any `export { ... }` lists.
  const exports = [];
  for (const m of source.matchAll(EXPORT_NAME_RE)) {
    exports.push({ local: m[1], exported: m[1] });
  }
  for (const m of source.matchAll(EXPORT_LIST_RE)) {
    for (const raw of m[1].split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      const as = entry.split(/\s+as\s+/);
      exports.push({ local: as[0].trim(), exported: (as[1] || as[0]).trim() });
    }
  }

  // Strip: imports and export lists go entirely; a declaration keeps
  // everything but the `export ` keyword.
  const body = source
    .replace(IMPORT_RE, '')
    .replace(BARE_IMPORT_RE, '')
    .replace(EXPORT_LIST_RE, '')
    .replace(EXPORT_DECL_RE, '');

  return { imports, exports, body };
}

// One import clause into the destructure that replaces it. `* as NS` and
// named lists are the only two forms the codebase uses; a default import is
// refused above by never matching either.
export function bindingFor(clause, id) {
  if (clause === null) return `void ${id};`;  // bare import: evaluation only
  const star = clause.match(/^\*\s+as\s+([A-Za-z0-9_$]+)$/);
  if (star) return `const ${star[1]} = ${id};`;
  const named = clause.match(/^\{([\s\S]*)\}$/);
  if (!named) throw new Error(`Import clause this bundler cannot rewrite: '${clause}'`);
  const parts = named[1].split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const as = p.split(/\s+as\s+/);
      return as[1] ? `${as[0].trim()}: ${as[1].trim()}` : as[0].trim();
    });
  return `const { ${parts.join(', ')} } = ${id};`;
}

// ---------- the graph ----------

export async function buildBundle(entryPath = ENTRY) {
  const modules = new Map();   // path -> { id, imports, exports, body, deps }
  const order = [];            // depth-first postorder — evaluation order
  const inStack = new Set();

  async function visit(path, chain) {
    if (modules.has(path)) {
      if (inStack.has(path)) {
        throw new Error(`Import cycle: ${[...chain, path].map((p) => relative(PROJECT, p)).join(' → ')}`);
      }
      return;
    }
    inStack.add(path);
    let source;
    try {
      source = await readFile(path, 'utf8');
    } catch {
      throw new Error(`Graph did not close: ${relative(PROJECT, path)} ` +
        `(imported from ${relative(PROJECT, chain[chain.length - 1] || '?')}) is unreadable`);
    }
    const mod = parseModule(source, relative(PROJECT, path));
    mod.deps = mod.imports.map((imp) => resolveSpec(imp.spec, path));
    modules.set(path, mod);
    for (const dep of mod.deps) await visit(dep, [...chain, path]);
    inStack.delete(path);
    order.push(path);
  }

  await visit(entryPath, []);

  const pieces = [];
  for (const path of order) {
    const mod = modules.get(path);
    const id = moduleId(path);
    const bindings = mod.imports
      .map((imp, i) => bindingFor(imp.clause, moduleId(mod.deps[i])))
      .join('\n');
    const returns = mod.exports
      .map((e) => (e.exported === e.local ? e.local : `${e.exported}: ${e.local}`))
      .join(', ');
    pieces.push(
      `// ---- ${relative(PROJECT, path)} ----\n` +
      `const ${id} = (() => {\n${bindings}\n${mod.body}\nreturn { ${returns} };\n})();`,
    );
  }

  const bundle = pieces.join('\n');

  // The two promises the output makes: nothing modular survived the rewrite,
  // and nothing in it can close the script tag it ships inside.
  if (/^import\s/m.test(bundle) || /^export\s/m.test(bundle)) {
    throw new Error('Bundle still contains a top-level import or export statement');
  }
  if (/<\/script/i.test(bundle)) {
    throw new Error('Bundle contains "</script>", which would end the tag it ships in');
  }

  return { bundle, files: order.map((p) => relative(PROJECT, p)) };
}

// ---------- the template ----------

export async function buildTemplate() {
  const shell = await readFile(SHELL_PATH, 'utf8');
  if (!shell.includes(BUNDLE_MARKER) || !shell.includes(DESIGN_MARKER)
      || !shell.includes(BAKE_MARKER)) {
    throw new Error('walk-shell.html has lost a splice marker');
  }
  const { bundle, files } = await buildBundle();
  // Function replacements throughout: the bundle is full of `$` sequences
  // that String.replace would otherwise treat as patterns.
  const html = shell.replace(BUNDLE_MARKER, () => bundle);
  return { html, files };
}

// A design payload (share.js's `z1.…` form) into a template. Used by the
// suite and by `--design`; the export button in the tool does the same
// replace in the browser. The bake rides the same way — its own slot, same
// codec — and an export that never had one leaves the marker standing,
// which walk-main.js reads as "live lighting".
export const spliceDesign = (template, payload) =>
  template.replace(DESIGN_MARKER, () => payload);

export const spliceBake = (template, payload) =>
  template.replace(BAKE_MARKER, () => payload);

// ---------- CLI ----------

async function main() {
  const { html, files } = await buildTemplate();
  await writeFile(TEMPLATE_PATH, html);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`walk-template.html — ${files.length} modules, ${kb(html.length)} ` +
    `(budget ${kb(TEMPLATE_BUDGET)})`);
  if (html.length > TEMPLATE_BUDGET) {
    console.error('Over budget — the template outgrew the number stated in this file.');
    process.exitCode = 1;
  }

  const flag = process.argv.indexOf('--design');
  if (flag >= 0) {
    const which = process.argv[flag + 1] || 'sample';
    // Imported here so the plain rebuild path stays dependency-free of the
    // model layer.
    const { serialize } = await import(pathToFileURL(join(PROJECT, 'js', 'save-load.js')));
    const { encodeShare } = await import(pathToFileURL(join(PROJECT, 'js', 'share.js')));
    let json;
    if (which === 'sample') {
      const { buildSampleSchool } = await import(pathToFileURL(join(PROJECT, 'js', 'sample.js')));
      json = serialize(buildSampleSchool(), { omitOverlay: true });
    } else {
      json = await readFile(which, 'utf8');
    }
    // Phase 27: the CLI export gets the baked light the button gets —
    // bakelight.js is pure, so Node bakes it as readily as the worker does.
    const { deserialize } = await import(pathToFileURL(join(PROJECT, 'js', 'save-load.js')));
    const { catalogEntry } = await import(pathToFileURL(join(PROJECT, 'js', 'catalog.js')));
    const { bakeLight, packBake, encodeBakeText } =
      await import(pathToFileURL(join(PROJECT, 'js', 'bakelight.js')));
    const packed = packBake(bakeLight(deserialize(json), catalogEntry));
    const out = join(PROJECT, 'walk.html');
    await writeFile(out, spliceBake(
      spliceDesign(html, await encodeShare(json)),
      await encodeShare(encodeBakeText(packed))));
    console.log(`walk.html — ${which === 'sample' ? 'the sample school' : which} embedded, light baked in`);
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
