// node tools/blender/validate.mjs [budget.json]
//
// Checks every model budget.json names against School Generator's style sheet
// (BACKLOG.md "Blender assets: the common plan", WISHLIST.md B1 and B2), with
// no dependency and no Blender, so Site CI runs it. Exits 1 on any failure
// (#13):
//
//   - a file that is missing, is not a glTF 2.0 binary, or is over its
//     class's bytes; a class whose caps reach gltf.js's own MAX_MODEL_BYTES or
//     MAX_TRIANGLES (a built-in prop is placed by the hundred, so the caps sit
//     well under them: this reads the two constants from the loader)
//   - anything js/gltf.js does not read: an extension (used or required), an
//     image, texture, sampler, skin, animation or camera, a primitive that is
//     not TRIANGLES, an attribute beyond POSITION, NORMAL and COLOR_0, a
//     primitive with no indices, a second material, a material with a
//     texture, an emissive or a base colour that is not white
//   - gltf.js itself refusing the file, or skipping a primitive of it
//   - triangles over the class cap
//   - the box: its base more than 1 cm off y = 0, its centre more than
//     `centre` metres off x = 0 or z = 0, or any side more than `tolerance` off
//     the box render.js's builder draws at the catalog row the item names
//   - the row's own w, d and h no longer being what js/catalog.js says
//   - a palette that is not what js/builtin-models.js's `tints` gives the
//     item's row: a role on one side only, or a hex that is not the recipe
//     applied to the row's colour in js/catalog.js (HISTORY #818)
//   - two roles of one file that are made differently and come out the same
//     colour, which `retint` could not tell apart (#819)
//   - a vertex colour that is not in the item's palette, or a palette colour
//     no vertex wears
//   - a .glb under assets/models/ that budget.json does not name
//
// The optional argument points it at another budget file; paths in it still
// resolve from the project folder. That is how the guard-rails were broken on
// purpose (#34) without touching the real one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..', '..');
const budgetPath = path.resolve(process.argv[2] || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

const { MAX_MODEL_BYTES, MAX_TRIANGLES, parseGLB, readModel } =
  await import(pathToFileURL(path.join(PROJECT, budget.loader)).href);
const { catalogEntry } = await import(pathToFileURL(path.join(PROJECT, 'js', 'catalog.js')).href);
const { BUILTIN_MODELS, builtinPalette } =
  await import(pathToFileURL(path.join(PROJECT, 'js', 'builtin-models.js')).href);

const toSrgb = c => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
};
const rgbOf = hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexOf = rgb => rgb.map(c => c.toString(16).padStart(2, '0')).join('');
const near = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= 1);

// ---------------------------------------------------------------- the classes

console.log(`loader: ${budget.loader}, MAX_MODEL_BYTES ${MAX_MODEL_BYTES}, MAX_TRIANGLES ${MAX_TRIANGLES}`);
for (const [name, cls] of Object.entries(budget.classes)) {
  ok(cls.triangles * 10 <= MAX_TRIANGLES, `class ${name}: ${cls.triangles} triangles is under a tenth of the loader's ${MAX_TRIANGLES}`);
  ok(cls.bytes * 10 <= MAX_MODEL_BYTES, `class ${name}: ${cls.bytes} bytes is under a tenth of the loader's ${MAX_MODEL_BYTES}`);
}

// ---------------------------------------------------------------- the items

const named = new Set();
const EXT_KEYS = new Set(['extensionsUsed', 'extensionsRequired']);
const NOT_READ = ['images', 'textures', 'samplers', 'skins', 'animations', 'cameras'];

for (const [name, item] of Object.entries(budget.items)) {
  console.log(`\n${name}`);
  const cls = budget.classes[item.class];
  if (!ok(cls, `${name}: class "${item.class}" is in the budget`)) continue;
  named.add(path.normalize(item.file));
  ok(item.file.startsWith('assets/models/') && item.file.endsWith('.glb'), `${name}: file ${item.file} is a .glb under assets/models/`);

  const row = catalogEntry(item.row.type);
  ok(row && row.w === item.row.w && row.d === item.row.d && row.h === item.row.h,
    `${name}: row ${item.row.type} is ${item.row.w} x ${item.row.d} x ${item.row.h} ft in js/catalog.js`,
    row ? `it is ${row.w} x ${row.d} x ${row.h}` : 'it is not in the catalog');

  const file = path.join(PROJECT, item.file);
  if (!ok(fs.existsSync(file), `${name}: ${item.file} exists`)) continue;
  const buf = fs.readFileSync(file);
  ok(buf.length <= cls.bytes, `${name}: bytes ${buf.length} within ${cls.bytes}`);

  let parsed;
  try { parsed = parseGLB(buf); } catch (e) { ok(false, `${name}: parses as a glTF binary`, e.message); continue; }
  const { json } = parsed;
  ok(json.asset && json.asset.version === '2.0', `${name}: glTF 2.0`);
  for (const k of EXT_KEYS) ok(json[k] === undefined, `${name}: no ${k}`, JSON.stringify(json[k]));
  const extensions = [];
  (function walk(v, at) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'extensions') extensions.push(at);
        walk(x, `${at}.${k}`);
      }
    }
  })(json, '');
  ok(!extensions.length, `${name}: no extension block anywhere`, extensions.join(', '));
  for (const k of NOT_READ) ok(!(json[k] && json[k].length), `${name}: no ${k}`);
  ok((json.nodes || []).every(n => n.skin === undefined && n.camera === undefined), `${name}: no node carries a skin or a camera`);

  const mats = json.materials || [];
  ok(mats.length === 1, `${name}: one material`, `${mats.length}`);
  const m = mats[0] || {};
  const pbr = m.pbrMetallicRoughness || {};
  ok(!pbr.baseColorTexture && !pbr.metallicRoughnessTexture && !m.normalTexture && !m.occlusionTexture && !m.emissiveTexture,
    `${name}: the material wires no texture`);
  ok(!m.emissiveFactor || m.emissiveFactor.every(c => c === 0), `${name}: no emission`);
  ok(!pbr.baseColorFactor || pbr.baseColorFactor.slice(0, 3).every(c => c > 0.999),
    `${name}: the base colour is white, so vertex colours come through unchanged`, JSON.stringify(pbr.baseColorFactor));

  let prims = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      prims++;
      ok(prim.mode === undefined || prim.mode === 4, `${name}: primitive ${prims} is TRIANGLES`, `mode ${prim.mode}`);
      const keys = Object.keys(prim.attributes || {}).sort().join(',');
      ok(keys === 'COLOR_0,NORMAL,POSITION', `${name}: primitive ${prims} carries POSITION, NORMAL and COLOR_0 and no more`, keys);
      ok(prim.indices !== undefined, `${name}: primitive ${prims} is indexed`);
      ok(prim.material === 0, `${name}: primitive ${prims} wears the one material`);
    }
  }
  ok(prims >= 1, `${name}: at least one primitive`);

  let model;
  try { model = readModel(parsed); } catch (e) { ok(false, `${name}: gltf.js reads it`, e.message); continue; }
  ok(model.skipped === 0, `${name}: gltf.js skips nothing`, `${model.skipped} skipped`);
  ok(model.triangles <= cls.triangles, `${name}: triangles ${model.triangles} within ${cls.triangles}`);

  // the box, in feet, against what the page's builder draws
  const b = model.bbox;
  const u = budget.unit;
  ok(Math.abs(b.minY) <= 0.01, `${name}: the base is on y = 0`, `min y ${b.minY.toFixed(4)} m`);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  ok(Math.abs(cx) <= budget.centre && Math.abs(cz) <= budget.centre,
    `${name}: the footprint is centred on the origin`, `centre ${cx.toFixed(3)}, ${cz.toFixed(3)} m`);
  const got = [(b.maxX - b.minX) / u, (b.maxZ - b.minZ) / u, (b.maxY - b.minY) / u];
  ['w', 'd', 'h'].forEach((axis, i) => {
    const want = item.box[i];
    ok(Math.abs(got[i] - want) <= want * budget.tolerance,
      `${name}: ${axis} ${got[i].toFixed(2)} ft is within ${budget.tolerance * 100}% of ${want}`);
  });

  // colour: the palette is the page's recipes applied to the row's colour
  const recipes = (BUILTIN_MODELS[name] || {}).tints || {};
  const want = row && BUILTIN_MODELS[name] ? builtinPalette(name, row.color) : {};
  ok(Object.keys(recipes).sort().join() === Object.keys(item.palette).sort().join(),
    `${name}: the palette's roles are the ones js/builtin-models.js tints`,
    `${Object.keys(item.palette).join(' ')} against ${Object.keys(recipes).join(' ')}`);
  for (const [role, hex] of Object.entries(item.palette)) {
    ok(want[role] === hex, `${name}: palette "${role}" ${hex} is its recipe on ${row ? row.color : 'no row'}`, `the recipe gives ${want[role]}`);
  }
  const roles = Object.keys(recipes);
  const clash = [];
  roles.forEach((a, i) => roles.slice(i + 1).forEach((b) => {
    if (JSON.stringify(recipes[a]) !== JSON.stringify(recipes[b]) && want[a] && want[b] && rgbOf(want[a]).every((c, k) => Math.abs(c - rgbOf(want[b])[k]) <= 2)) clash.push(`${a}/${b}`);
  }));
  ok(!clash.length, `${name}: no two roles made differently are within two steps of one colour`, clash.join(' '));

  // every vertex in the palette, every palette entry on some vertex
  const palette = Object.entries(item.palette).map(([role, hex]) => ({ role, rgb: rgbOf(hex), seen: false }));
  const strays = new Set();
  for (const part of model.meshes) {
    const c = part.color;
    for (let i = 0; i < c.length; i += 3) {
      const rgb = [toSrgb(c[i]), toSrgb(c[i + 1]), toSrgb(c[i + 2])];
      // two roles may share a colour (the page's darkest tints are all black)
      const hits = palette.filter(p => near(p.rgb, rgb));
      if (hits.length) hits.forEach(p => { p.seen = true; }); else strays.add(hexOf(rgb));
    }
  }
  ok(!strays.size, `${name}: every vertex colour is in the palette`, [...strays].slice(0, 6).join(' '));
  for (const p of palette) ok(p.seen, `${name}: palette "${p.role}" ${hexOf(p.rgb)} is worn by some vertex`);
}

// ---------------------------------------------------------------- strays

const dir = path.join(PROJECT, 'assets', 'models');
const held = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f !== '.gitkeep') : [];
const extra = held.filter(f => !named.has(path.normalize(path.join('assets', 'models', f))));
console.log('');
ok(!extra.length, 'assets/models/ holds only what budget.json names', extra.join(', '));

console.log(`${passed} assertions passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
