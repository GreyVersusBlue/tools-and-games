// data.mjs — Throneshard's data layer, checked without a browser.
//
//   node Projects/throneshard/test/data.mjs
//
// Exits non-zero on any failed check (#13). Every hero, ability, talent,
// item recipe, item build and model file the game names has to resolve: a
// renamed id that one table missed shows up here as a dangling reference
// rather than as a hero with an empty ability bar in a live match.
//
// The ability files import `three` through `util.js`. The page gets it from
// the importmap; Node gets it from the resolve hook registered below, which
// maps the same two specifiers to the same vendored files.

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LIBS = pathToFileURL(path.join(ROOT, 'libs') + path.sep).href;

const hook = `
const LIBS = ${JSON.stringify(LIBS)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: LIBS + 'three.module.js', shortCircuit: true };
  if (spec.startsWith('three/examples/jsm/')) return { url: LIBS + 'addons/' + spec.slice(19), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { HERO_DEFS } = await load('src/gameplay/heroes/HeroDefs.js');
const { ABILITY_DEFS } = await load('src/gameplay/abilities/AbilitySystem.js');
const { TALENT_DEFS, TALENT_TIERS } = await load('src/gameplay/talents/TalentDefs.js');
const { ITEM_DEFS } = await load('src/gameplay/items/ItemDefs.js');
const { RECOMMENDED } = await load('src/gameplay/items/ItemBuilds.js');

let checks = 0, failures = 0;
function ok(cond, label, detail = '') {
  checks++;
  if (cond) return;
  failures++;
  console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`);
}

const heroes = Object.values(HERO_DEFS);
console.log(`heroes: ${heroes.length}`);
ok(heroes.length === 14, 'fourteen heroes', `got ${heroes.length}`);

const usedAbilities = new Set();
for (const h of heroes) {
  ok(h.id && h.name && h.title, `${h.id}: has id, name and title`);
  ok(Array.isArray(h.abilities) && h.abilities.length === 4, `${h.id}: four abilities`);
  for (const [i, id] of (h.abilities ?? []).entries()) {
    const a = ABILITY_DEFS[id];
    usedAbilities.add(id);
    ok(!!a, `${h.id}: ability ${id} is defined`);
    if (!a) continue;
    ok(id.startsWith(h.id + '_'), `${h.id}: ability ${id} carries the hero's prefix`);
    ok(a.name && a.description, `${id}: has a name and a description`);
    ok(!!a.ultimate === (i === 3), `${id}: only the fourth ability is the ultimate`);
    if (i === 3) ok(!!a.scepter?.description, `${id}: the ultimate has a scepter upgrade`);
  }

  const tree = TALENT_DEFS[h.id];
  ok(!!tree, `${h.id}: has its own talent tree`);
  for (const lvl of TALENT_TIERS) {
    const pair = tree?.[lvl];
    ok(Array.isArray(pair) && pair.length === 2, `${h.id}: two talents at level ${lvl}`);
    for (const t of pair ?? []) {
      if (t.ability) ok(h.abilities.includes(t.ability), `${h.id} L${lvl} "${t.name}": names one of the hero's own abilities`, t.ability);
    }
  }

  const build = RECOMMENDED[h.id];
  ok(!!build, `${h.id}: has an item build`);
  for (const phase of ['starting', 'early', 'core', 'late']) {
    for (const item of build?.[phase] ?? []) ok(!!ITEM_DEFS[item], `${h.id} build ${phase}: item ${item} exists`);
  }

  const glb = path.join(ROOT, 'assets/models/chars', `${h.id}.glb`);
  ok(fs.existsSync(glb), `${h.id}: model file exists`, path.relative(ROOT, glb));
}
ok(usedAbilities.size === 56, 'fifty-six distinct hero abilities', `got ${usedAbilities.size}`);

const items = Object.values(ITEM_DEFS);
console.log(`items: ${items.length}`);
ok(items.length === 111, '111 items', `got ${items.length}`);
for (const it of items) {
  ok(it.name && Number.isFinite(it.cost), `${it.id}: has a name and a cost`);
  for (const c of it.components ?? []) ok(!!ITEM_DEFS[c], `${it.id}: component ${c} exists`);
}

// Every storage key the game writes starts with the game's own prefix, so it can
// never collide with another project's key on the same origin.
const keyRe = /localStorage\.(?:get|set|remove)Item\(\s*['"`]([^'"`]+)/g;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const keys = new Set();
for (const f of walk(path.join(ROOT, 'src'))) for (const m of fs.readFileSync(f, 'utf8').matchAll(keyRe)) keys.add(m[1]);
console.log(`storage keys: ${keys.size}`);
ok(keys.size > 0, 'found the storage keys');
for (const k of keys) ok(k.startsWith('throneshard'), `storage key ${k} starts with "throneshard"`);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
