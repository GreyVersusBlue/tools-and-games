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

// Runes and Grimmaw's drop. A rune's kind and type are bare strings compared in
// four files, and the drop's event is emitted in one file and heard in another:
// a rename that misses one of them leaves a bot that walks past a rune, a
// minimap marker of the wrong shape, or an announcement that never shows.
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { RUNE_TYPES, BOON_RUNE_SPOTS, WINDFALL_RUNE_SPOTS } = await load('src/gameplay/runes/Runes.js');
const runesSrc = read('src/gameplay/runes/Runes.js');
const runeTypes = Object.keys(RUNE_TYPES);
const runeKinds = new Set([...runesSrc.matchAll(/this\.spawn\([^;]*,\s*'(\w+)'\)/g)].map((m) => m[1]));
console.log(`runes: ${runeTypes.length} types, ${runeKinds.size} kinds`);
ok(runeTypes.length === 7, 'seven rune types', `got ${runeTypes.length}`);
ok(runeKinds.size === 2, 'Runes.js spawns two kinds of rune', `got ${[...runeKinds]}`);
ok(BOON_RUNE_SPOTS?.length === 2 && WINDFALL_RUNE_SPOTS?.length === 4, 'two river spots and four jungle spots');
for (const t of [...runesSrc.matchAll(/this\.spawn\('(\w+)'/g)]) ok(!!RUNE_TYPES[t[1]], `Runes.js spawns a defined type ${t[1]}`);
for (const t of [...runesSrc.matchAll(/case '(\w+)':/g)]) ok(!!RUNE_TYPES[t[1]], `Runes.activate handles a defined type ${t[1]}`);
const kindRe = /\b(?:r|m|x|rune)\.kind === '(\w+)'/g;
for (const rel of ['src/gameplay/runes/Runes.js', 'src/ai/BotBrain.js', 'src/ui/hud/MinimapMarkers.js', 'tools/scripts/ws5_shots.mjs']) {
  const found = [...read(rel).matchAll(kindRe)].map((m) => m[1]).filter((k) => k !== 'hero');
  ok(found.length > 0, `${rel}: compares a rune's kind`);
  for (const k of found) ok(runeKinds.has(k), `${rel}: rune kind ${k} is one Runes.js spawns`);
}
const colKeys = [...read('src/vfx/effects/runes.js').match(/const COL = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
ok(colKeys.join() === runeTypes.join(), 'the rune effects have a colour pair for each type, in order', `got ${colKeys}`);
const captured = [...read('tools/scripts/vfx_capture.mjs').match(/const RUNES = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
ok(captured.join() === runeTypes.join(), 'vfx_capture.mjs lists the same rune types', `got ${captured}`);
const coinRe = read('src/audio/AudioSystem.js').match(/if \((\/[^/]+\/i)\.test\(reason/)[1];
for (const m of runesSrc.matchAll(/addGold\(gold, '(\w+)'\)/g)) ok(new RegExp(coinRe.slice(1, -2), 'i').test(m[1]), `the coin sound hears the gold reason ${m[1]}`);
// Every rune:, lantern: and grimmaw: event something listens for is emitted somewhere.
const srcText = walk(path.join(ROOT, 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const emitted = new Set([...srcText.matchAll(/\.emit\('([\w:]+)'/g)].map((m) => m[1]));
const heard = new Set([...srcText.matchAll(/\.on\('((?:rune|lantern|grimmaw):[\w]+)'/g)].map((m) => m[1]));
ok(heard.has('lantern:consumed') && heard.size >= 4, 'found the rune, lantern and grimmaw listeners', `got ${[...heard]}`);
for (const e of heard) ok(emitted.has(e), `event ${e} is emitted somewhere`);

// Rift Wall's gameplay wall: its lifetime, the push-out, and seeded walks through and round it (wall.mjs).
const { wallChecks } = await import('./wall.mjs');
await wallChecks({ ok, load });

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
